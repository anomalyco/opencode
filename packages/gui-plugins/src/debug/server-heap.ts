import { ClientError, OpenCode } from "@opencode/client/promise"
import { Predicate } from "effect"
import path from "node:path"
import type { ServerEndpoint } from "@opencode/plugin/gui/main"

type Memory = Readonly<Record<"rss" | "heapTotal" | "heapUsed" | "external" | "arrayBuffers", number>>

/**
 * What the manifest records about the desktop server's snapshot.
 * - `file`: the server wrote it into the folder.
 * - `path`: the server wrote it elsewhere, because it predates choosing a directory and used its log directory.
 *   Snapshots are large, so it is not moved or copied.
 * - `error`: nothing was captured.
 *
 * `memory` is the server's `process.memoryUsage()` in bytes just before the snapshot; servers released before it was
 * added leave it out.
 */
export type ServerSnapshot =
  | { readonly process: "server"; readonly pid: number; readonly file: string; readonly memory?: Memory }
  | { readonly process: "server"; readonly pid: number; readonly path: string; readonly memory?: Memory }
  | { readonly process: "server"; readonly error: string }

/**
 * Asks the desktop's own server to write a heap snapshot into `directory`. Never rejects: a failure becomes an
 * `error` entry.
 *
 * @param endpoint - The desktop's server, or undefined while it is not running.
 * @param directory - An absolute folder on this machine; the server creates it when missing.
 * @param signal - Aborts the request; the server still finishes the file it started.
 */
export async function captureServer(
  endpoint: ServerEndpoint | undefined,
  directory: string,
  signal: AbortSignal,
): Promise<ServerSnapshot> {
  if (!endpoint) return { process: "server", error: "The server is not running." }

  return OpenCode.make({ baseUrl: endpoint.url, headers: endpoint.headers })
    .debug.heapDump({ directory }, { signal })
    .then(
      (snapshot): ServerSnapshot =>
        // The server joins the directory and file name, so the same join recognizes a snapshot it wrote there.
        path.join(directory, path.basename(snapshot.path)) === snapshot.path
          ? { process: "server", pid: snapshot.pid, file: path.basename(snapshot.path), memory: snapshot.memory }
          : { process: "server", pid: snapshot.pid, path: snapshot.path, memory: snapshot.memory },
      (error: Error): ServerSnapshot => ({
        process: "server",
        error: unsupported(error)
          ? "The server does not support heap dumps. Update and restart it."
          : error.message || String(error),
      }),
    )
}

// Servers released before the endpoint answer 404.
function unsupported(error: Error) {
  return (
    error instanceof ClientError &&
    error.reason === "UnexpectedStatus" &&
    Predicate.hasProperty(error.cause, "status") &&
    error.cause.status === 404
  )
}
