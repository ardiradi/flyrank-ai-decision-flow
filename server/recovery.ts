import type { WorkflowRun } from "../shared/types";
import { describeRunRecovery, runStore } from "./store";

export { RunRecoveryError, RunLeaseRevokedError, RUN_LEASE_MS } from "./store";

/** Add current recovery guidance to API output without changing persisted history. */
export function withRunRecovery(run: WorkflowRun): WorkflowRun {
  return { ...run, recovery: describeRunRecovery(run) };
}

/** Call after confirming Inngest is available, then queueRun(snapshot..., snapshot.id). */
export async function recoverStaleRun(id: string): Promise<WorkflowRun> {
  return runStore.interruptStale(id);
}
