import { NonRetriableError } from "inngest";
import { RUN_HEARTBEAT_MS, RunLeaseRevokedError, runStore } from "./store";

export function stopRevokedWorker(error: unknown): never {
  if (error instanceof RunLeaseRevokedError) throw new NonRetriableError(error.message);
  throw error;
}

/** Heartbeats exist only while actual work is in flight, not while Inngest is idle. */
export async function withWorkerHeartbeat<T>(runId: string, leaseId: string, work: () => Promise<T>): Promise<T> {
  await runStore.heartbeat(runId, leaseId).catch(stopRevokedWorker);
  let failure: unknown;
  let heartbeat: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (heartbeat) return;
    heartbeat = runStore.heartbeat(runId, leaseId).catch((error) => { failure = error; clearInterval(timer); }).finally(() => { heartbeat = undefined; });
  }, RUN_HEARTBEAT_MS);
  timer.unref();
  try {
    const result = await work();
    if (heartbeat) await heartbeat;
    if (failure) stopRevokedWorker(failure);
    // An expired/recovered fence is checked before its result can be persisted.
    await runStore.heartbeat(runId, leaseId).catch(stopRevokedWorker);
    return result;
  } finally {
    clearInterval(timer);
    if (heartbeat) await heartbeat;
  }
}
