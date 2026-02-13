/**
 * Upstream event stream management
 * Connects to sandbox OpenCode servers and forwards events to the gateway bus
 */
import { resolveDirectoryUpstream } from "../../services/sandbox-resolver.ts";
import { normalizeDirectory } from "../lib/paths.ts";
import { logJson } from "../lib/logging.ts";
import { broadcastGlobal } from "./bus.ts";
import { type GlobalBusPayload } from "./types.ts";
import { getConvex } from "../../clients/index.ts";
import { api } from "../../../convex/_generated/api.js";

// Track active upstream streams by directory
const upstreamGlobalStreams = new Map<string, AbortController>();

/**
 * Sleep with abort signal support
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Read SSE stream and call onEvent for each event
 */
async function readSseStream(
  res: Response,
  onEvent: (data: string) => Promise<void>,
  signal: AbortSignal
): Promise<void> {
  const body = res.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const chunk = await reader.read().catch(() => null);
    if (!chunk) return;
    if (chunk.done) return;

    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      const data = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data) continue;
      await onEvent(data);
    }
  }
}

/**
 * Ensure an upstream event stream is running for a directory
 */
export async function ensureUpstreamGlobalStream(directory: string): Promise<void> {
  const dir = normalizeDirectory(directory);
  if (!dir) return;
  if (upstreamGlobalStreams.has(dir)) return;

  const abort = new AbortController();
  upstreamGlobalStreams.set(dir, abort);

  const run = async () => {
    const convex = getConvex();
    while (!abort.signal.aborted) {
      const resolved = await resolveDirectoryUpstream(dir).catch(() => null);
      if (!resolved?.sandboxUrl) {
        await sleep(1000, abort.signal);
        continue;
      }

      const workspaceId = resolved.workspaceId;
      const url = `${resolved.sandboxUrl.replace(/\/+$/, "")}/global/event`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          "user-agent": "claxedo-gateway/1.0",
          "X-Daytona-Skip-Preview-Warning": "true",
        },
        signal: abort.signal,
      }).catch(() => null);

      if (!res || !res.ok) {
        await sleep(1000, abort.signal);
        continue;
      }

      await readSseStream(
        res,
        async (data) => {
          try {
            const parsed = JSON.parse(data) as any;
            const payload = parsed?.payload as GlobalBusPayload | undefined;
            if (!payload) return;

            const info = payload.properties?.info as any;
            if (payload.type === "session.deleted" && info?.id) {
              void convex
                .mutation(api.sessions.remove, { sessionId: String(info.id) })
                .catch((err) =>
                  logJson("error", { kind: "session.remove.failed", error: String(err), source: "upstream" }),
                );
            }

            if ((payload.type === "session.created" || payload.type === "session.updated") && info?.id && info?.title) {
              if (info?.time?.archived) {
                void convex
                  .mutation(api.sessions.remove, { sessionId: String(info.id) })
                  .catch((err) =>
                    logJson("error", { kind: "session.remove.failed", error: String(err), source: "upstream" }),
                  );
                return;
              }

              void convex
                .mutation(api.sessions.sync, {
                  workspaceId,
                  sessionId: String(info.id),
                  title: String(info.title),
                  slug: String(info.slug ?? info.id),
                  updatedAt: Number(info?.time?.updated ?? Date.now()),
                })
                .catch((err) =>
                  logJson("error", { kind: "session.sync.failed", error: String(err), source: "upstream" }),
                );
            }
            // Filter out server-specific events without directory context
            if (
              (payload.type === "server.connected" || payload.type === "server.heartbeat") &&
              !parsed?.directory
            ) {
              return;
            }
            await broadcastGlobal({ directory: parsed?.directory, payload });
          } catch {
            // ignore malformed events
          }
        },
        abort.signal
      );
    }
  };

  void run().finally(() => {
    upstreamGlobalStreams.delete(dir);
  });
}

/**
 * Touch a directory to ensure its upstream stream is running
 */
export function touchDirectory(directory: string): void {
  const dir = normalizeDirectory(directory);
  if (!dir) return;
  void ensureUpstreamGlobalStream(dir);
}

/**
 * Stop upstream stream for a directory
 */
export function stopUpstreamStream(directory: string): void {
  const dir = normalizeDirectory(directory);
  const abort = upstreamGlobalStreams.get(dir);
  if (abort) {
    abort.abort();
    upstreamGlobalStreams.delete(dir);
  }
}

/**
 * Stop all upstream streams
 */
export function stopAllUpstreamStreams(): void {
  for (const abort of upstreamGlobalStreams.values()) {
    abort.abort();
  }
  upstreamGlobalStreams.clear();
}
