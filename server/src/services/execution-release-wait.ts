import type { Db } from "@paperclipai/db";
import { getExecutionBlocker } from "./execution-blocker.js";

/**
 * How long a hand-off will wait for the run it just stopped to let go of the issue.
 *
 * `cancelRun` returns as soon as the run row is fenced. The environment lease that
 * keeps the issue locked is released later by the runtime finalizer, typically
 * 0.8-1.0 s afterwards. A successor wake that lands inside that window is written as
 * a terminal `execution_reconciliation_required` receipt and never runs, because a
 * plain assignment wake carries no comment or interaction id to defer on. Two
 * measured hand-offs lost that race by 21 ms and 13 ms, so the window is short but
 * real; polling for it costs nothing once the lease is already gone.
 */
export const DEFAULT_EXECUTION_RELEASE_WAIT_MS = 2_000;
export const DEFAULT_EXECUTION_RELEASE_POLL_MS = 100;

export interface ExecutionReleaseWaitOptions {
  /** Only wait for this run's release. A blocker held by any other run is not ours to wait for. */
  runId?: string | null;
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Wait, bounded, for an issue's execution blocker to clear after its run was stopped.
 *
 * Returns true when the issue is free (or became free), false when it stayed blocked
 * for the whole budget or when the blocker belongs to a different run than `runId`.
 * Never throws: a poll failure is treated as "still blocked" and the caller keeps
 * today's behaviour.
 */
export async function waitForExecutionRelease(
  db: Db,
  companyId: string,
  issueId: string,
  options: ExecutionReleaseWaitOptions = {},
): Promise<boolean> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_EXECUTION_RELEASE_WAIT_MS);
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_EXECUTION_RELEASE_POLL_MS);
  const runId = options.runId ?? null;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    let blocker: { runId?: string | null } | null = null;
    try {
      blocker = (await getExecutionBlocker(db, companyId, issueId)) ?? null;
    } catch {
      return false;
    }
    if (!blocker) return true;
    // A different run holds the issue: waiting cannot help, and the successor wake
    // must still be enqueued so the blocker's own release path can promote it.
    if (runId && blocker.runId && blocker.runId !== runId) return false;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}
