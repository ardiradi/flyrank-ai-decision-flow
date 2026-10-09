import "./config";
import { Inngest, NonRetriableError } from "inngest";
import { executeGraph } from "./execute";
import { decide, safeError } from "./decision";
import { runStore } from "./store";
import { stopRevokedWorker, withWorkerHeartbeat } from "./worker-lease";
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
      await runStore.markFailedIfActive(runId, safeError(error));
    },
  },
  async ({ event, step }) => {
    const runId = event.data.runId as string;
    // Use the immutable snapshot stored by the API, never accept executable event data.
    const run = runStore.get(runId);
    if (!run) throw new Error("Run not found.");
    if (run.status === "interrupted") throw new NonRetriableError("This run was explicitly recovered. Its original history is preserved and the retry has a separate run ID.");
    const leaseId = await step.run("claim-worker-lease", () => runStore.claimLease(runId).catch(stopRevokedWorker));
    const graph = parseGraph(run.graph);
    const mode: ExecutionMode = run.mode;
    const steps = await executeGraph(
      graph,
      run.input,
      async (node, input, previous) => {
        try { return await withWorkerHeartbeat(runId, leaseId, () => decide(mode, node, input, previous)); }
        catch (error) {
          if (error instanceof NonRetriableError) throw error;
          await runStore.updateWithLease(runId, leaseId, { status: "retrying", error: safeError(error) }).catch(stopRevokedWorker);
          throw error;
        }
      },
      async <T>(id: string, work: () => Promise<T>) => await step.run(id, work) as T,
      async (node) => {
        const latest = runStore.get(runId)!;
        await runStore.updateWithLease(runId, leaseId, { status: "running", activeNodeId: node.id, error: null, attempts: { ...latest.attempts, [node.id]: (latest.attempts[node.id] || 0) + 1 } }).catch(stopRevokedWorker);
      },
      async (result) => {
        const latest = runStore.get(runId)!;
        await runStore.updateWithLease(runId, leaseId, { steps: [...latest.steps.filter((item) => item.nodeId !== result.nodeId), result], activeNodeId: null }).catch(stopRevokedWorker);
      },
    );
    await step.run("complete-run", async () => {
      await runStore.updateWithLease(runId, leaseId, { status: "completed", steps, activeNodeId: null, error: null }).catch(stopRevokedWorker);
      return { runId, path: steps.map((item) => `${item.nodeId}:${item.decision}`) };
    });
    return { runId, mode, decisions: steps.map(({ nodeId, decision }) => ({ nodeId, decision })) };
  },
);
