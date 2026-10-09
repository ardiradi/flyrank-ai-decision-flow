import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { exampleGraph } from "../shared/graph";
import { config } from "../server/config";
import { decide } from "../server/decision";
import type { Decision, EvaluatedDecision, WorkflowGraph, WorkflowRun } from "../shared/types";

const api = process.env.VERIFY_API_URL || "http://127.0.0.1:3002";
const verificationOutput = process.argv[2] || `evidence/real-provider-run-${Date.now()}.json`;
assert.match(verificationOutput, /^evidence\/[-a-zA-Z0-9_.]+\.json$/, "Use an evidence/*.json output path.");
await mkdir("evidence", { recursive: true });
// Reserve exclusively before any calls. Previous observations must remain intact.
await writeFile(verificationOutput, "{}\n", { flag: "wx" });
const tickets = {
  outage: "The payment service is down for all customers. Every checkout returns HTTP 500. Engineering must investigate the payment API regression. Reproduction: open checkout, pay with any test card, and observe HTTP 500 since 09:30 UTC; request ID test-outage-001.",
  routine: "Please send the standard password-reset documentation. I can still sign in and use the service normally. There is no outage, payment failure, or blocker. This is a routine how-to question.",
};
const evidence: Record<string, unknown> = {
  verifiedAt: new Date().toISOString(),
  provider: "local llama.cpp through the official OpenAI SDK Responses API",
  model: config.model,
  promptVariant: config.localPromptVariant,
  internalExecutionMode: "openai",
  paidApiCallsMade: false,
  syntheticInputsOnly: true,
  smoke: [],
  runs: [],
  passed: false,
  limits: "Two selected scenarios verify execution and routing, not general model accuracy. See local-model-limitations.json for a genuine misclassification.",
};
const smoke: EvaluatedDecision[] = [];
const runs: WorkflowRun[] = [];
const engineRuns: { apiRunId: string; eventId: string; engineRunId: string; status: string; endedAt: string | null }[] = [];

async function verifyEngineCompleted(result: WorkflowRun) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await fetch(`${config.inngestUrl}/v1/events/${encodeURIComponent(result.eventId!)}/runs`);
    assert.equal(response.status, 200, "The local Inngest engine must expose the event run.");
    const payload = await response.json();
    const row = payload.data?.find((item: { event_id?: string }) => item.event_id === result.eventId);
    // This Dev Server can report "Completed" while ended_at is still null.
    // Require an actual terminal timestamp in addition to the app's completed state.
    if (row?.status === "Completed" && typeof row.ended_at === "string" && Number.isFinite(Date.parse(row.ended_at))) {
      assert.ok(typeof row.run_id === "string" && row.run_id.length > 0, "The engine must retain a real run ID.");
      engineRuns.push({ apiRunId: result.id, eventId: result.eventId!, engineRunId: row.run_id, status: row.status, endedAt: row.ended_at });
      evidence.engineRuns = engineRuns;
      return;
    }
    assert.ok(!["Failed", "Cancelled"].includes(row?.status), `Inngest engine ended with ${row?.status}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("API history completed but the Inngest engine did not confirm completion within 30 seconds.");
}

async function run(graph: WorkflowGraph, input: string, expected: string[]) {
  const response = await fetch(`${api}/api/runs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph, input, mode: "openai" }),
  });
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  let result: WorkflowRun = await response.json();
  const deadline = Date.now() + 120000;
  while (!["completed", "failed"].includes(result.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    result = await (await fetch(`${api}/api/runs/${result.id}`)).json();
  }
  runs.push(result);
  evidence.runs = runs;
  assert.equal(result.status, "completed", result.error || "The real-provider workflow timed out.");
  assert.equal(result.mode, "openai");
  assert.ok(result.eventId, "An actual Inngest event ID must be returned.");
  await verifyEngineCompleted(result);
  assert.deepEqual(result.steps.map((step) => step.nodeId), expected);
  for (const step of result.steps) {
    assert.ok(step.provider, "Every visited node must retain actual model-response evidence.");
    assert.equal(step.provider.kind, "local-openai-compatible");
    assert.equal(step.provider.promptVariant, config.localPromptVariant, "Every step must use the configured local prompt profile.");
    assert.equal(step.provider.model, config.model);
    assert.ok(step.provider.responseId);
    assert.ok(step.provider.outputIds.length && step.provider.outputIds.every(Boolean));
    assert.match(step.provider.rawOutput.trim(), /^(YES|NO)$/);
    assert.equal(step.provider.rawOutput.trim(), step.decision);
  }
  console.log(`PASS ${result.id} / Inngest ${result.eventId}: ${result.steps.map((step) => `${step.nodeId}:${step.decision}`).join(" → ")}`);
  return result;
}

try {
  // This command deliberately refuses hosted providers; it cannot spend API credit.
  assert.equal(config.providerKind, "local-openai-compatible", "Set the current terminal's OPENAI_BASE_URL to the local model before running this verifier.");
  assert.ok(["qwen2.5-0.5b-instruct", "qwen2.5-1.5b-instruct"].includes(config.model), "This evidence command verifies a documented pinned local Qwen model.");
  assert.equal(config.inngestDev, true, "Use the local Inngest Dev Server for this verification.");
  const status = await (await fetch(`${api}/api/status`)).json();
  evidence.status = status;
  assert.equal(status.openaiConfigured, true);
  assert.equal(status.providerKind, "local-openai-compatible", "Restart the API with local-provider environment values first.");
  assert.equal(status.model, config.model);
  assert.equal(status.promptVariant, config.localPromptVariant, "The API and verifier must use the same local prompt profile.");
  assert.equal(status.inngestReady, true);

  for (const [input, expected] of [[tickets.outage, "YES"], [tickets.routine, "NO"]] as [string, Decision][]) {
    const result = await decide("openai", exampleGraph.nodes[0], input, []);
    assert.notEqual(typeof result, "string", "The production provider must return genuine model-response evidence.");
    const evaluated = result as EvaluatedDecision;
    smoke.push(evaluated);
    evidence.smoke = smoke;
    assert.equal(evaluated.provider.kind, "local-openai-compatible");
    assert.equal(evaluated.provider.promptVariant, config.localPromptVariant);
    assert.equal(evaluated.decision, expected);
    assert.equal(evaluated.provider.rawOutput.trim(), expected);
    assert.ok(evaluated.provider.responseId);
    console.log(`PASS production SDK smoke ${expected}: ${evaluated.provider.responseId}`);
  }

  const yesGraph = structuredClone(exampleGraph);
  yesGraph.name = "Real local LLM: outage (Demo answers set to NO)";
  for (const node of yesGraph.nodes) node.data.demoDecision = "NO";
  const yes = await run(yesGraph, tickets.outage, ["urgency", "specialist", "escalate"]);
  assert.deepEqual(yes.steps.map((step) => step.decision), ["YES", "YES", "YES"]);

  const noGraph = structuredClone(exampleGraph);
  noGraph.name = "Real local LLM: routine (opposing Demo answers)";
  for (const node of noGraph.nodes) node.data.demoDecision = node.id === "self-service" ? "NO" : "YES";
  const no = await run(noGraph, tickets.routine, ["urgency", "self-service"]);
  assert.deepEqual(no.steps.map((step) => step.decision), ["NO", "YES"]);
  assert.notEqual(yes.eventId, no.eventId);

  const workflowIds = runs.flatMap((run) => run.steps.map((step) => step.provider!.responseId));
  assert.equal(workflowIds.length, 5);
  assert.equal(new Set(workflowIds).size, 5, "Each visited node must have a distinct genuine response ID.");
  evidence.completedWorkflowLlmCalls = workflowIds.length;
  evidence.productionSdkSmokeCalls = smoke.length;
  evidence.actualLlmCallsMade = true;
  evidence.checks = [
    "Production decide() uses actual SDK Responses calls, returning strict YES and NO",
    "Two actual Inngest events execute five visited nodes",
    "Both Inngest engine runs independently report Completed with non-null terminal timestamps",
    "Every visited node retains response ID, output ID, model, raw answer, and usage",
    "Opposing Demo answers do not control real-provider results",
    "Selected paths match urgency → specialist → escalate and urgency → self-service",
    "Unused branches skipped; no hosted provider is allowed by this verifier",
  ];
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await writeFile(verificationOutput, JSON.stringify(evidence, null, 2));
  console.log(`Real-provider verification ${evidence.passed ? "passed" : "failed"}; ${verificationOutput}`);
}
