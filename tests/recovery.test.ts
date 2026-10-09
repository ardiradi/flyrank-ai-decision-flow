import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRunStore, describeRunRecovery, RUN_LEASE_MS, RunLeaseRevokedError, RunRecoveryError } from "../server/store";
import { executeGraph } from "../server/execute";
import { exampleGraph } from "../shared/graph";
import type { WorkflowRun } from "../shared/types";

const start = Date.parse("2026-10-09T06:00:00.000Z");
function fixture(id: string, status: WorkflowRun["status"] = "queued"): WorkflowRun {
  const now = new Date(start).toISOString();
  return { id, graph: structuredClone(exampleGraph), input: "Immutable test input", mode: "demo", status, createdAt: now, updatedAt: now, steps: [], activeNodeId: null, attempts: {}, error: null };
}
async function isolated(clock: () => number = () => start) {
  const directory = await mkdtemp(path.join(tmpdir(), "be09-recovery-test-"));
  const store = createRunStore(directory, { now: clock });
  await store.initialize();
  return { store, directory };
}

test("queued/running/retrying recovery requires expiry; active heartbeats extend it", async () => {
  let clock = start;
  const { store } = await isolated(() => clock);
  for (const status of ["queued", "running", "retrying"] as const) {
    const run = fixture(status, status);
    await store.create(run);
    assert.equal(describeRunRecovery(store.get(run.id)!, clock).eligible, false);
    await assert.rejects(store.interruptStale(run.id), RunRecoveryError);
  }
  const leaseId = await store.claimLease("running");
  clock += RUN_LEASE_MS - 1;
  await store.heartbeat("running", leaseId);
  clock += 2;
  assert.equal(describeRunRecovery(store.get("queued")!, clock).eligible, true);
  assert.equal(describeRunRecovery(store.get("retrying")!, clock).eligible, true);
  assert.equal(describeRunRecovery(store.get("running")!, clock).eligible, false);
  assert.equal(store.get("queued")!.status, "queued", "eligibility does not silently rewrite status");
});

test("explicit recovery preserves immutable input and evidence, and fences late callbacks", async () => {
  let clock = start;
  const { store, directory } = await isolated(() => clock);
  const original = fixture("with-evidence");
  original.steps = [{ nodeId: "urgency", title: "Urgency", decision: "YES", nextNodeId: "specialist", durationMs: 1, completedAt: original.createdAt, provider: { kind: "local-openai-compatible", model: "unit-test-fixture", responseId: "fixture-response", outputIds: ["fixture-output"], rawOutput: "YES" } }];
  await store.create(original);
  const leaseId = await store.claimLease(original.id);
  await store.updateWithLease(original.id, leaseId, { status: "running", activeNodeId: "specialist", attempts: { urgency: 1, specialist: 1 } });
  clock += RUN_LEASE_MS;
  const interrupted = await store.interruptStale(original.id);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.activeNodeId, null);
  assert.deepEqual(interrupted.graph, original.graph);
  assert.equal(interrupted.input, original.input);
  assert.deepEqual(interrupted.steps, original.steps);
  await assert.rejects(store.updateWithLease(original.id, leaseId, { status: "completed", steps: [] }), RunLeaseRevokedError);
  await assert.rejects(store.heartbeat(original.id, leaseId), RunLeaseRevokedError);
  await assert.rejects(store.claimLease(original.id), RunLeaseRevokedError);
  await store.markFailedIfActive(original.id, "late Inngest failure callback");
  assert.deepEqual(store.get(original.id), interrupted);
  const persisted = JSON.parse(await readFile(path.join(directory, "runs.json"), "utf8")) as WorkflowRun[];
  assert.deepEqual(persisted[0], interrupted);
});

test("recovery races accept exactly one explicit interruption and never overwrite completed runs", async () => {
  let clock = start;
  const { store } = await isolated(() => clock);
  await store.create(fixture("queued-race"));
  clock += RUN_LEASE_MS;
  const results = await Promise.allSettled([store.interruptStale("queued-race"), store.interruptStale("queued-race")]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  for (const status of ["completed", "failed", "interrupted"] as const) {
    await store.create(fixture(`terminal-${status}`, status));
    await assert.rejects(store.interruptStale(`terminal-${status}`), RunRecoveryError);
    await store.markFailedIfActive(`terminal-${status}`, "late failure");
    assert.equal(store.get(`terminal-${status}`)!.status, status);
  }
});

test("readers and untyped patch callers cannot modify the stored immutable snapshot", async () => {
  const { store } = await isolated();
  const original = fixture("immutable");
  await store.create(original);
  const detached = store.get(original.id)!;
  detached.input = "changed externally";
  detached.graph.nodes[0].data.prompt = "changed externally";
  await store.update(original.id, { input: "untyped modification", graph: { changed: true } } as never);
  assert.equal(store.get(original.id)!.input, original.input);
  assert.deepEqual(store.get(original.id)!.graph, original.graph);
  await assert.rejects(store.create({ ...original, input: "duplicate replacement" }), /already exists/);
});

test("real worker process kill/restart retains progress; explicit recovery runs a separate linked retry", async (context) => {
  const { directory } = await isolated();
  const loader = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
  const workerPath = fileURLToPath(new URL("./fixtures/recovery-worker.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", loader, workerPath, directory, String(start)], { stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let errorText = "";
  child.stderr.on("data", (chunk) => { errorText += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Worker readiness timeout: ${errorText}`)), 10000);
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("READY")) { clearTimeout(timeout); resolve(); } });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Worker exited early (${code}): ${errorText}`)); });
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
  const restarted = createRunStore(directory, { now: () => start + RUN_LEASE_MS + 1 });
  await restarted.initialize();
  const crashed = restarted.get("isolated-crashed-worker")!;
  assert.equal(crashed.status, "running");
  assert.equal(crashed.activeNodeId, "specialist");
  assert.deepEqual(crashed.steps.map((step) => step.nodeId), ["urgency"]);
  assert.equal(describeRunRecovery(crashed, start + RUN_LEASE_MS + 1).eligible, true);
  const preserved = await restarted.interruptStale(crashed.id);
  const retry: WorkflowRun = { ...fixture("separate-retry"), graph: preserved.graph, input: preserved.input, mode: preserved.mode, retriedFrom: preserved.id };
  await restarted.create(retry);
  const retryLease = await restarted.claimLease(retry.id);
  const steps = await executeGraph(retry.graph, retry.input, async () => "YES", async (_id, work) => work(), async (node) => { await restarted.updateWithLease(retry.id, retryLease, { status: "running", activeNodeId: node.id }); }, async (step) => { await restarted.updateWithLease(retry.id, retryLease, { steps: [...restarted.get(retry.id)!.steps, step] }); });
  await restarted.updateWithLease(retry.id, retryLease, { status: "completed", activeNodeId: null, steps });
  assert.equal(restarted.get(retry.id)!.status, "completed");
  assert.equal(restarted.get(retry.id)!.retriedFrom, crashed.id);
  assert.deepEqual(restarted.get(crashed.id), preserved);
  assert.deepEqual(steps.map((step) => step.nodeId), ["urgency", "specialist", "escalate"]);
});
