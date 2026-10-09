import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { RUN_LEASE_MS } from "../server/store";
import type { WorkflowGraph, WorkflowRun } from "../shared/types";

// Windows-only local integration probe. It owns separate API/engine processes,
// every Inngest listener, and fresh temporary history. No provider is configured.
assert.equal(process.platform, "win32", "This verifier checks Windows process identity before termination.");
const repo = process.cwd();
const output = process.argv[2] || "evidence/live-inngest-restart-recovery-verification.json";
assert.match(output, /^evidence\/[-a-zA-Z0-9_.]+\.json$/);
const ports = { api: 3032, engine: 8329, gateway: 8330, gatewayGrpc: 53352, executorGrpc: 53353 };
const api = `http://127.0.0.1:${ports.api}`;
const engine = `http://127.0.0.1:${ports.engine}`;
const directory = await mkdtemp(path.join(tmpdir(), "be09-live-recovery-"));
const dataFile = path.join(directory, "runs.json");
const loader = pathToFileURL(path.join(repo, "node_modules/tsx/dist/loader.mjs")).href;
const engineBinary = path.join(repo, "node_modules/inngest-cli/bin/inngest.exe");
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const execFileAsync = promisify(execFile);
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const evidence: Record<string, any> = {
  schemaVersion: 1, startedAt: new Date().toISOString(), completedAt: null, passed: false,
  mode: "demo", syntheticInputOnly: true, llmCallsMade: false, paidApiCallsMade: false,
  isolation: { ports, dataDirectoryBasename: path.basename(directory), freshTemporaryHistory: true, userHistoryTouched: false, existingServicesTouched: false },
  source: { api: "server/index.ts", function: "server/inngest.ts", store: "server/store.ts", leaseMilliseconds: RUN_LEASE_MS },
  lifecycle: [], checks: [],
  boundaries: [
    "The actual local Inngest Dev Server and API worker are abruptly terminated and restarted on isolated ports.",
    "The engine uses its default unpersisted development state; engine execution state is lost while API JSON history is retained.",
    "The expiry wait uses the persisted production five-minute lease and real wall-clock time; no clock or saved history is edited.",
    "Demo uses deterministic configured YES answers and makes no LLM or paid provider calls; this does not measure model quality or frontend behavior.",
    "The event-runs endpoint can report Completed before ended_at is populated. Terminal verification requires completed API history and a non-null engine end timestamp, not status alone.",
  ],
};
await writeFile(output, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + "\n");

interface Identity { ProcessId: number; ExecutablePath: string; CommandLine: string; CreationDate: string }
interface OwnedProcess { child: ChildProcess; label: string; executable: string; identity: Identity; output: string }
const owned: OwnedProcess[] = [];
async function identity(pid: number): Promise<Identity | undefined> {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const command = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ProcessId,ExecutablePath,CommandLine,@{Name='CreationDate';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true });
  return stdout.trim() ? JSON.parse(stdout) : undefined;
}
async function assertFree(port: number) {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", () => probe.close((error) => error ? reject(error) : resolve())); });
}
async function launch(label: string, executable: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let spawnError: Error | undefined;
  child.once("error", (error) => { spawnError = error; });
  await delay(150);
  if (spawnError) throw spawnError;
  assert.ok(child.pid, `${label} did not receive a PID.`);
  const initial = await identity(child.pid);
  assert.ok(initial, `${label} exited during launch.`);
  assert.equal(path.resolve(initial.ExecutablePath).toLowerCase(), path.resolve(executable).toLowerCase());
  const item: OwnedProcess = { child, label, executable, identity: initial, output: "" };
  const capture = (chunk: Buffer) => { item.output = (item.output + String(chunk)).slice(-12000); };
  child.stdout!.on("data", capture); child.stderr!.on("data", capture);
  owned.push(item);
  evidence.lifecycle.push({ action: "launch", label, pid: child.pid, executable: path.basename(executable), identityVerified: true, at: new Date().toISOString() });
  console.log(`Launched owned ${label} PID ${child.pid}.`);
  return item;
}
async function stop(item: OwnedProcess) {
  if (item.child.exitCode !== null || item.child.signalCode !== null) return;
  const current = await identity(item.child.pid!);
  assert.ok(current, `Owned ${item.label} process identity is unavailable; refusing termination.`);
  assert.equal(current.ProcessId, item.identity.ProcessId);
  assert.equal(current.CreationDate, item.identity.CreationDate, "PID was reused; refusing termination.");
  assert.equal(path.resolve(current.ExecutablePath).toLowerCase(), path.resolve(item.executable).toLowerCase());
  assert.equal(current.CommandLine, item.identity.CommandLine);
  const exited = new Promise<void>((resolve) => item.child.once("exit", () => resolve()));
  assert.equal(item.child.kill("SIGKILL"), true);
  await Promise.race([exited, delay(10000).then(() => { throw new Error(`Owned ${item.label} did not terminate.`); })]);
  evidence.lifecycle.push({ action: "abrupt-stop", label: item.label, pid: item.child.pid, identityVerifiedBeforeStop: true, at: new Date().toISOString() });
  console.log(`Stopped verified owned ${item.label} PID ${item.child.pid}.`);
}
async function waitFor<T>(label: string, work: () => Promise<T | undefined>, milliseconds = 60000): Promise<T> {
  const deadline = Date.now() + milliseconds;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { const value = await work(); if (value !== undefined) return value; }
    catch (error) { lastError = error; }
    await delay(200);
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ""}.`);
}
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  return { status: response.status, body };
}
async function getRun(id: string): Promise<WorkflowRun> {
  const response = await json(`${api}/api/runs/${id}`);
  assert.equal(response.status, 200);
  return response.body;
}
async function engineRuns(eventId: string) {
  const response = await json(`${engine}/v1/events/${encodeURIComponent(eventId)}/runs`);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.data));
  return response.body.data as { run_id: string; event_id: string; status: string; ended_at?: string }[];
}
async function startPair(generation: string) {
  const apiEnv: NodeJS.ProcessEnv = { ...process.env, HOST: "127.0.0.1", PORT: String(ports.api), RUN_DATA_DIRECTORY: directory,
    INNGEST_DEV: "1", INNGEST_BASE_URL: engine, OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/v1", OPENAI_MODEL: "synthetic-demo-no-model" };
  const worker = await launch(`API-${generation}`, process.execPath, ["--import", loader, path.join(repo, "server/index.ts")], apiEnv, repo);
  await waitFor("isolated API health", async () => { const response = await json(`${api}/api/status`); return response.status === 200 ? response.body : undefined; });
  const orchestrator = await launch(`Inngest-${generation}`, engineBinary, ["dev", "--host", "127.0.0.1", "--no-discovery", "-u", `${api}/api/inngest`,
    "--port", String(ports.engine), "--connect-gateway-port", String(ports.gateway), "--connect-gateway-grpc-port", String(ports.gatewayGrpc),
    "--connect-executor-grpc-port", String(ports.executorGrpc)], { ...process.env }, directory);
  const status = await waitFor("isolated engine health", async () => {
    const response = await json(`${api}/api/status`);
    return response.body.inngestReady ? response.body : undefined;
  });
  assert.equal(status.openaiConfigured, false);
  evidence.lifecycle.push({ action: "pair-ready", generation, providerConfigured: false, at: new Date().toISOString() });
  return { worker, orchestrator };
}
function preservedView(run: WorkflowRun) {
  const { recovery: _recovery, ...stored } = run;
  return stored;
}

try {
  for (const port of Object.values(ports)) await assertFree(port);
  const originalPair = await startPair("original");
  const graph: WorkflowGraph = { version: 1, name: "Synthetic live-restart recovery chain", entryNodeId: "synthetic-01", nodes: [], edges: [] };
  for (let index = 1; index <= 40; index++) {
    const id = `synthetic-${String(index).padStart(2, "0")}`;
    graph.nodes.push({ id, type: "decision", position: { x: 0, y: index * 80 }, data: { title: `Synthetic decision ${index}`, prompt: "Does this synthetic fixture use the configured Demo YES path?", demoDecision: "YES" } });
    if (index < 40) graph.edges.push({ id: `synthetic-edge-${index}`, source: id, target: `synthetic-${String(index + 1).padStart(2, "0")}`, sourceHandle: "YES" });
  }
  const requested = await json(`${api}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph, input: "Synthetic deterministic live engine restart recovery fixture. No user information or provider inference.", mode: "demo" }) });
  assert.equal(requested.status, 202);
  const id = requested.body.id as string;
  const active = await waitFor("persisted active decision and lease", async () => {
    const run = await getRun(id);
    return run.status === "running" && run.lease && run.steps.length > 0 && run.activeNodeId ? run : undefined;
  });
  evidence.originalActiveObservation = active;
  const initialEngineRun = await waitFor("initial actual engine run", async () => (await engineRuns(active.eventId!)).find((row) => row.event_id === active.eventId));
  evidence.originalEngineRunBeforeStop = initialEngineRun;
  assert.ok(!initialEngineRun.ended_at, "The original engine run must not have an end timestamp while this API snapshot is actively evaluating.");
  await stop(originalPair.worker);
  await stop(originalPair.orchestrator);
  const persisted: WorkflowRun[] = JSON.parse(await readFile(dataFile, "utf8"));
  const crashed = persisted.find((run) => run.id === id)!;
  assert.ok(crashed && crashed.status === "running" && crashed.lease && crashed.activeNodeId);
  assert.ok(crashed.steps.length > 0 && crashed.steps.length < graph.nodes.length);
  const expiry = Date.parse(crashed.lease.expiresAt);
  assert.ok(expiry > Date.now() + 270000, "The production five-minute lease must remain mostly unexpired at the actual crash.");
  evidence.persistedOriginalAfterCrash = crashed;
  evidence.checks.push("A real Demo Inngest run had persisted completed-node evidence and an active worker lease before owned processes were abruptly stopped.");

  await startPair("restarted");
  assert.deepEqual(preservedView(await getRun(id)), crashed);
  const early = await json(`${api}/api/runs/${id}/recover`, { method: "POST" });
  assert.equal(early.status, 409);
  evidence.earlyRecovery = { at: new Date().toISOString(), httpStatus: early.status, error: early.body.error };
  const lost = await engineRuns(crashed.eventId!);
  assert.deepEqual(lost, [], "Default unpersisted engine state must be lost after this restart.");
  evidence.restartedEngineOldEventRuns = lost;
  evidence.wait = { startedAt: new Date().toISOString(), persistedExpiresAt: crashed.lease.expiresAt, remainingMillisecondsAtStart: expiry - Date.now(), clock: "real Date.now(), no overrides", elapsedMilliseconds: null };
  await save();
  console.log(`WAITING_REAL_LEASE_EXPIRY ${crashed.lease.expiresAt}; remaining ${Math.ceil((expiry - Date.now()) / 1000)} seconds.`);
  const waitStart = Date.now();
  let nextProgress = Date.now() + 30000;
  while (Date.now() < expiry) {
    await delay(Math.min(5000, expiry - Date.now()));
    const current = await getRun(id);
    assert.deepEqual(preservedView(current), crashed, "An engine restart must not silently modify stranded history.");
    if (Date.now() >= nextProgress) { console.log(`Real lease wait: ${Math.max(0, Math.ceil((expiry - Date.now()) / 1000))} seconds remain.`); nextProgress = Date.now() + 30000; }
  }
  evidence.wait.elapsedMilliseconds = Date.now() - waitStart;
  evidence.wait.finishedAt = new Date().toISOString();
  const expired = await getRun(id);
  assert.equal(expired.recovery?.eligible, true);
  assert.deepEqual(preservedView(expired), crashed);
  evidence.expiredOriginalBeforeRecovery = expired;
  const recovered = await json(`${api}/api/runs/${id}/recover`, { method: "POST" });
  assert.equal(recovered.status, 202, JSON.stringify(recovered.body));
  const retryId = recovered.body.id as string;
  assert.notEqual(retryId, id);
  assert.equal(recovered.body.retriedFrom, id);
  const interrupted = await getRun(id);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.lease, undefined);
  assert.equal(interrupted.activeNodeId, null);
  assert.deepEqual(interrupted.graph, crashed.graph);
  assert.equal(interrupted.input, crashed.input);
  assert.deepEqual(interrupted.steps, crashed.steps);
  assert.deepEqual(interrupted.attempts, crashed.attempts);
  evidence.recoveryHttpStatus = recovered.status;
  evidence.interruptedOriginal = interrupted;
  evidence.checks.push("After restart the original stayed unchanged, healthy recovery was rejected with HTTP409, and real lease expiry exposed recovery eligibility.", "HTTP Recover returned 202, preserved immutable input/graph/completed steps/attempts, revoked the original lease, and created a distinct linked run.");
  const retry = await waitFor("linked retry API completion", async () => {
    const run = await getRun(retryId);
    if (run.status === "failed" || run.status === "interrupted") throw new Error(`Retry ended ${run.status}: ${run.error}`);
    return run.status === "completed" ? run : undefined;
  }, 90000);
  assert.deepEqual(retry.steps.map((step) => step.nodeId), graph.nodes.map((node) => node.id));
  assert.ok(retry.steps.every((step) => step.decision === "YES" && !step.provider));
  const completedEngineRun = await waitFor("linked retry actual engine completion", async () => (await engineRuns(retry.eventId!)).find((row) => row.event_id === retry.eventId && row.status === "Completed" && row.ended_at));
  assert.deepEqual(await getRun(id), interrupted, "The original evidence must still be intact after the full retry completes.");
  evidence.completedRetry = retry;
  evidence.completedRetryEngineRun = completedEngineRun;
  evidence.checks.push("The linked retry completed all 40 Demo nodes and its distinct actual Inngest engine run independently reported Completed.", "The interrupted original remained unchanged after retry completion; no model response evidence or LLM calls were present.");
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  for (const item of [...owned].reverse()) {
    try { await stop(item); }
    catch (error) { evidence.cleanupError = error instanceof Error ? error.message : String(error); evidence.passed = false; process.exitCode = 1; }
  }
  evidence.completedAt = new Date().toISOString();
  await save();
  console.log(`Live Inngest restart recovery ${evidence.passed ? "PASS" : "FAIL"}; ${output}`);
}
