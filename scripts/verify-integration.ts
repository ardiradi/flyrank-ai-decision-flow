import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { exampleGraph } from "../shared/graph";
import type { WorkflowRun } from "../shared/types";

const base = process.env.VERIFY_API_URL || "http://127.0.0.1:3002";
const status = await (await fetch(`${base}/api/status`)).json();
assert.equal(status.inngestReady, true, "Start both the API and Inngest Dev Server first.");
const evidence: Record<string, unknown> = { verifiedAt: new Date().toISOString(), mode: "demo", openaiCallsMade: false, status, runs: [] };

async function run(graph = structuredClone(exampleGraph)) {
  const response = await fetch(`${base}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph, input: "An example support request for durable branch testing.", mode: "demo" }) });
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  let result: WorkflowRun = await response.json();
  const deadline = Date.now() + 30000;
  while (!["completed", "failed"].includes(result.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    result = await (await fetch(`${base}/api/runs/${result.id}`)).json();
  }
  assert.equal(result.status, "completed", result.error || "The run did not complete in 30 seconds.");
  assert.ok(result.eventId, "The API must send a real Inngest event.");
  return result;
}
const yes = await run();
assert.deepEqual(yes.steps.map((step) => step.nodeId), ["urgency", "specialist", "escalate"]);
const noGraph = structuredClone(exampleGraph);
noGraph.nodes.find((node) => node.id === "urgency")!.data.demoDecision = "NO";
const no = await run(noGraph);
assert.deepEqual(no.steps.map((step) => step.nodeId), ["urgency", "self-service"]);
const retryCompleted = await fetch(`${base}/api/runs/${yes.id}/retry`, { method: "POST" });
assert.equal(retryCompleted.status, 409);
const invalidGraph = structuredClone(exampleGraph);
invalidGraph.edges.push({ id: "loop", source: "escalate", target: "urgency", sourceHandle: "YES" });
const invalid = await fetch(`${base}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph: invalidGraph, input: "test", mode: "demo" }) });
assert.equal(invalid.status, 400);
evidence.runs = [yes, no];
evidence.checks = ["Real Inngest event IDs returned", "YES visits urgency → specialist → escalate", "NO visits urgency → self-service", "Unused branches skipped", "Completed-run retry rejected with 409", "Cyclic graph rejected with 400"];
await mkdir("evidence", { recursive: true });
await writeFile("evidence/integration-verification.json", JSON.stringify(evidence, null, 2));
console.log("PASS: actual local Inngest executed both YES and NO paths in Demo mode.");
console.log("OpenAI calls made: false. Evidence: evidence/integration-verification.json");
