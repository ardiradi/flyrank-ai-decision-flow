import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { RunRecovery, WorkflowRun } from "../shared/types";

export const RUN_LEASE_MS = 5 * 60 * 1000;
export const RUN_HEARTBEAT_MS = 15 * 1000;
const activeStatuses = new Set(["queued", "running", "retrying"]);
type RunPatch = Partial<Pick<WorkflowRun, "status" | "eventId" | "steps" | "activeNodeId" | "attempts" | "error">>;

export class RunRecoveryError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export class RunLeaseRevokedError extends Error {
  constructor() { super("This worker was superseded by explicit recovery. No further history changes were accepted."); }
}

export function describeRunRecovery(run: WorkflowRun, now = Date.now(), leaseMs = RUN_LEASE_MS): RunRecovery {
  if (!activeStatuses.has(run.status)) return { eligible: false, staleAfter: null, message: run.status === "interrupted" ? "The original run was interrupted; its existing evidence is preserved. Retry creates a separate run." : "This run does not need interruption recovery." };
  // Older history has no lease. Its last persisted progress remains the safe baseline.
  const expiry = run.lease ? Date.parse(run.lease.expiresAt) : Date.parse(run.updatedAt) + leaseMs;
  if (!Number.isFinite(expiry)) return { eligible: false, staleAfter: null, message: "The saved timestamp is invalid. Inspect the run history before recovery." };
  const eligible = now >= expiry;
  return { eligible, staleAfter: new Date(expiry).toISOString(), message: eligible ? "No worker heartbeat or queue progress was recorded before the lease expired. Recover explicitly to preserve this run and queue a separate retry." : "The run still has a valid worker or queue lease. Recovery becomes available after five minutes without progress." };
}

/** One API process owns this JSON store. Separate processes must use separate directories. */
export function createRunStore(dataDirectory: string, options: { now?: () => number; leaseMs?: number } = {}) {
  const dataFile = path.join(dataDirectory, "runs.json");
  const runs = new Map<string, WorkflowRun>();
  const now = options.now || Date.now;
  const leaseMs = options.leaseMs || RUN_LEASE_MS;
  let writes = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify([...runs.values()], null, 2);
    writes = writes.catch(() => {}).then(async () => {
      const temporary = `${dataFile}.tmp`;
      await writeFile(temporary, snapshot, "utf8");
      await rename(temporary, dataFile);
    });
    return writes;
  }
  function existing(id: string) {
    const run = runs.get(id);
    if (!run) throw new RunRecoveryError("Run not found.", 404);
    return run;
  }
  function matchingLease(id: string, leaseId: string) {
    const run = existing(id);
    if (!activeStatuses.has(run.status) || run.lease?.id !== leaseId) throw new RunLeaseRevokedError();
    return run;
  }
  function patchRun(run: WorkflowRun, patch: RunPatch) {
    // Runtime allow-list protects immutable snapshots even from untyped callers.
    for (const key of ["status", "eventId", "steps", "activeNodeId", "attempts", "error"] as const) {
      if (Object.hasOwn(patch, key)) Object.assign(run, { [key]: structuredClone(patch[key]) });
    }
    run.updatedAt = new Date(now()).toISOString();
  }
  const store = {
    async initialize() {
      await mkdir(dataDirectory, { recursive: true });
      try {
        const data: WorkflowRun[] = JSON.parse(await readFile(dataFile, "utf8"));
        runs.clear();
        for (const run of data) runs.set(run.id, run);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Run history could not be loaded. Inspect the saved runs.json before restarting.");
      }
    },
    get(id: string) { const run = runs.get(id); return run ? structuredClone(run) : undefined; },
    list() { return structuredClone([...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)); },
    async create(run: WorkflowRun) {
      if (runs.has(run.id)) throw new Error("A run with this ID already exists.");
      // Keep all historical evidence; only the listing is limited to the latest 100 runs.
      const snapshot = structuredClone(run);
      delete snapshot.recovery;
      runs.set(run.id, snapshot);
      await persist();
      return store.get(run.id)!;
    },
    async update(id: string, patch: RunPatch) {
      const run = existing(id);
      patchRun(run, patch);
      await persist();
      return store.get(id)!;
    },
    async claimLease(id: string) {
      const run = existing(id);
      if (!activeStatuses.has(run.status)) throw new RunLeaseRevokedError();
      // Inngest may replay this step; retain the same fence until explicit recovery.
      run.lease ??= { id: randomUUID(), expiresAt: new Date(now() + leaseMs).toISOString() };
      run.lease.expiresAt = new Date(now() + leaseMs).toISOString();
      await persist();
      return run.lease.id;
    },
    async updateWithLease(id: string, leaseId: string, patch: RunPatch) {
      const run = matchingLease(id, leaseId);
      patchRun(run, patch);
      run.lease!.expiresAt = new Date(now() + leaseMs).toISOString();
      await persist();
      return store.get(id)!;
    },
    async heartbeat(id: string, leaseId: string) {
      const run = matchingLease(id, leaseId);
      run.lease!.expiresAt = new Date(now() + leaseMs).toISOString();
      await persist();
    },
    async markFailedIfActive(id: string, error: string) {
      const run = runs.get(id);
      if (!run || !activeStatuses.has(run.status)) return;
      patchRun(run, { status: "failed", activeNodeId: null, error });
      await persist();
    },
    async interruptStale(id: string) {
      const run = existing(id);
      const recovery = describeRunRecovery(run, now(), leaseMs);
      if (!recovery.eligible) throw new RunRecoveryError(recovery.message);
      // Check and revoke synchronously before awaiting persistence, fencing in-flight work.
      delete run.lease;
      patchRun(run, { status: "interrupted", activeNodeId: null, error: "Explicitly recovered after the worker lease expired. Original input and completed steps were preserved; retry starts a separate run." });
      await persist();
      return store.get(id)!;
    },
  };
  return store;
}

const dataDirectory = process.env.RUN_DATA_DIRECTORY || fileURLToPath(new URL("../.data/", import.meta.url));
export const runStore = createRunStore(dataDirectory);
export const initializeStore = () => runStore.initialize();
