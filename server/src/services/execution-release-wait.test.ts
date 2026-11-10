import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecutionBlocker = vi.hoisted(() => vi.fn(async (): Promise<Record<string, unknown> | null> => null));
vi.mock("./execution-blocker.js", () => ({ getExecutionBlocker: mockExecutionBlocker }));

import { waitForExecutionRelease } from "./execution-release-wait.js";

const db = {} as never;
const COMPANY_ID = "company-1";
const ISSUE_ID = "issue-1";
const RUN_ID = "run-1";

beforeEach(() => {
  mockExecutionBlocker.mockReset();
  mockExecutionBlocker.mockResolvedValue(null);
});

describe("waitForExecutionRelease", () => {
  it("returns immediately when the issue is already free", async () => {
    const startedAt = Date.now();
    await expect(waitForExecutionRelease(db, COMPANY_ID, ISSUE_ID, { runId: RUN_ID })).resolves.toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(50);
    expect(mockExecutionBlocker).toHaveBeenCalledTimes(1);
  });

  it("waits out the lease release of the run it just cancelled", async () => {
    mockExecutionBlocker
      .mockResolvedValueOnce({ runId: RUN_ID, cause: "run_active" })
      .mockResolvedValueOnce({ runId: RUN_ID, cause: "run_active" })
      .mockResolvedValueOnce(null);

    await expect(
      waitForExecutionRelease(db, COMPANY_ID, ISSUE_ID, { runId: RUN_ID, timeoutMs: 500, pollMs: 2 }),
    ).resolves.toBe(true);
    expect(mockExecutionBlocker).toHaveBeenCalledTimes(3);
  });

  it("gives up at the deadline and leaves today's behaviour in place", async () => {
    mockExecutionBlocker.mockResolvedValue({ runId: RUN_ID, cause: "run_active" });

    await expect(
      waitForExecutionRelease(db, COMPANY_ID, ISSUE_ID, { runId: RUN_ID, timeoutMs: 20, pollMs: 5 }),
    ).resolves.toBe(false);
    expect(mockExecutionBlocker.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not wait for a blocker held by a different run", async () => {
    mockExecutionBlocker.mockResolvedValue({ runId: "some-other-run", cause: "run_active" });

    await expect(
      waitForExecutionRelease(db, COMPANY_ID, ISSUE_ID, { runId: RUN_ID, timeoutMs: 500, pollMs: 5 }),
    ).resolves.toBe(false);
    expect(mockExecutionBlocker).toHaveBeenCalledTimes(1);
  });

  it("treats a failing blocker read as still blocked instead of throwing", async () => {
    mockExecutionBlocker.mockRejectedValue(new Error("db down"));

    await expect(waitForExecutionRelease(db, COMPANY_ID, ISSUE_ID, { runId: RUN_ID })).resolves.toBe(false);
  });
});
