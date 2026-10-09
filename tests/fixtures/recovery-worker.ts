import { createRunStore } from "../../server/store";
import { executeGraph } from "../../server/execute";
import { exampleGraph } from "../../shared/graph";
import type { WorkflowRun } from "../../shared/types";

const directory = process.argv[2];
const clock = Number(process.argv[3]);
const store = createRunStore(directory, { now: () => clock });
await store.initialize();
const now = new Date(clock).toISOString();
const run: WorkflowRun = { id: "isolated-crashed-worker", graph: structuredClone(exampleGraph), input: "Immutable isolated crash fixture", mode: "demo", status: "queued", createdAt: now, updatedAt: now, steps: [], activeNodeId: null, attempts: {}, error: null };
await store.create(run);
const leaseId = await store.claimLease(run.id);
// This process is killed while its second node is actually in flight.
const keepAlive = setInterval(() => {}, 1000);
await executeGraph(run.graph, run.input, async (node) => {
  if (node.id === "specialist") {
    process.stdout.write("READY\n");
    await new Promise(() => {});
  }
  return "YES";
}, async (_id, work) => work(), async (node) => {
  await store.updateWithLease(run.id, leaseId, { status: "running", activeNodeId: node.id, attempts: { ...store.get(run.id)!.attempts, [node.id]: 1 } });
}, async (step) => {
  await store.updateWithLease(run.id, leaseId, { steps: [...store.get(run.id)!.steps, step], activeNodeId: null });
});
clearInterval(keepAlive);
