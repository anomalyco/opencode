/**
 * Sandbox preview URL resolution for Daytona sandboxes
 */
import { getDaytona } from "../clients/index.ts";
import { Config } from "../config/index.ts";
import { logJson, nowMs } from "../server/lib/logging.ts";

/**
 * Error thrown when sandbox needs to be woken up
 */
export class SandboxNotStartedError extends Error {
  constructor(public sandboxId: string, public state: string) {
    super(`Sandbox ${sandboxId} is not started (state: ${state})`);
    this.name = "SandboxNotStartedError";
  }
}

/**
 * Get a signed preview URL for a sandbox.
 * Throws SandboxNotStartedError if sandbox is not in "started" state.
 */
export async function getSandboxPreviewBaseUrl(
  sandboxId: string,
  port: number
): Promise<string> {
  const reqId = (globalThis as any).__claxedo_reqId as string | undefined;
  const t0 = nowMs();

  // Fetch sandbox and check state
  const sandbox = await getDaytona().get(sandboxId);
  const state = (sandbox as any)?.state as string | undefined;

  // Check if sandbox is actually running - if not, throw error to trigger wake
  if (state && state !== "started") {
    logJson("info", {
      reqId,
      kind: "daytona.preview.not_started",
      sandboxId,
      port,
      state,
      durationMs: nowMs() - t0,
    });
    throw new SandboxNotStartedError(sandboxId, state);
  }

  // Get signed preview URL
  const expiresInSeconds = Config.DAYTONA_SIGNED_PREVIEW_TTL_SEC;
  const signed = await sandbox.getSignedPreviewUrl(port, expiresInSeconds);
  const url = String((signed as any)?.url ?? "").replace(/\/+$/, "");

  if (!url) {
    throw new Error("Daytona signed preview url missing");
  }

  logJson("info", {
    reqId,
    kind: "daytona.preview.ok",
    sandboxId,
    port,
    state,
    urlHost: (() => {
      try {
        return new URL(url).host;
      } catch {
        return undefined;
      }
    })(),
    durationMs: nowMs() - t0,
  });

  return url;
}
