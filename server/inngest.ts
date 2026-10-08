import "./config";
import { Inngest } from "inngest";
import { executeGraph } from "./execute";
import { decide, safeError } from "./decision";
import { runStore } from "./store";
import { parseGraph } from "../shared/graph";
import type { ExecutionMode } from "../shared/types";

export const inngest = new Inngest({ id: "flyrank-ai-decision-flow" });

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute-decision-workflow",
    name: "Execute AI decision workflow",
    triggers: [{ event: "workflow/run.requested" }],
    retries: 2,
    concurrency: { limit: 5 },
    onFailure: async ({ event, error }) => {
      const runId = event.data.event.data.runId as string;
      if (runStore.get(runId)) await runStore.update(runId, { status: "failed", activeNodeId: null, error: safeError(error) });
    },
  },
  async ({ event, step }) => {
    const runId = event.data.runId as string;
    // Use the immutable snapshot stored by the API, never accept executable event data.
    const run = runStore.get(runId);
    if (!run) throw new Error("Run not found.");
    const graph = parseGraph(run.graph);
    const mode: ExecutionMode = run.mode;
    const steps = await executeGraph(
      graph,
      run.input,
      async (node, input, previous) => {
        try { return await decide(mode, node, input, previous); }
        catch (error) {
          await runStore.update(runId, { status: "retrying", error: safeError(error) });
          throw error;
        }
      },
      async <T>(id: string, work: () => Promise<T>) => await step.run(id, work) as T,
      async (node) => {
        const latest = runStore.get(runId)!;
        await runStore.update(runId, { status: "running", activeNodeId: node.id, error: null, attempts: { ...latest.attempts, [node.id]: (latest.attempts[node.id] || 0) + 1 } });
      },
      async (result) => {
        const latest = runStore.get(runId)!;
        await runStore.update(runId, { steps: [...latest.steps.filter((item) => item.nodeId !== result.nodeId), result], activeNodeId: null });
      },
    );
    await step.run("complete-run", async () => {
      await runStore.update(runId, { status: "completed", steps, activeNodeId: null, error: null });
      return { runId, path: steps.map((item) => `${item.nodeId}:${item.decision}`) };
    });
    return { runId, mode, decisions: steps.map(({ nodeId, decision }) => ({ nodeId, decision })) };
  },
);
