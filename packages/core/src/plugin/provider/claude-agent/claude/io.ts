export * as ClaudeIO from "./io.js"

import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { which } from "../../../../util/which.js"
import { ClaudeFork } from "./fork.js"
import { ClaudeSDK } from "./sdk.js"

// Everything that reaches outside opencode. Tests swap it for a fake `claude`.
export interface Interface {
  // Undefined uses the SDK's own spawn
  readonly spawn?: Options["spawnClaudeCodeProcess"]
  readonly which: () => string | undefined
  // Before our isolation settings
  readonly env: () => Record<string, string | undefined>
  readonly sessionExists: (sessionID: string, configDir?: string) => Promise<boolean>
  readonly fork: (sessionID: string, messageID: string, configDir?: string) => Promise<ClaudeFork.Result | undefined>
  readonly remove: (sessionID: string, configDir?: string) => Promise<void>
}

export const real: Interface = {
  which: () => process.env.OPENCODE_CLAUDE_PATH || which("claude") || undefined,
  env: () => process.env,
  sessionExists: async (sessionID, configDir) => {
    if (configDir) {
      // Look for the transcript the way the SDK does. Loading the SDK in a worker for this would slow every resume.
      const projects = path.join(configDir, "projects")
      const folders = await readdir(projects).catch(() => [])
      for (const folder of folders) {
        const file = await stat(path.join(projects, folder, `${sessionID}.jsonl`)).catch(() => undefined)
        if (file && file.size > 0) return true
      }
      return false
    }
    const { getSessionInfo } = await ClaudeSDK.load()
    return (await getSessionInfo(sessionID)) !== undefined
  },
  fork: async (sessionID, messageID, configDir) => {
    if (!configDir) return helpers.fork(sessionID, messageID)
    try {
      return await inFolder(configDir, "fork", [sessionID, messageID])
    } catch (error) {
      // Without the worker, as in the Node build, a fresh Claude session replays the history instead.
      if (error instanceof WorkerUnavailableError) return undefined
      throw error
    }
  },
  remove: (sessionID, configDir) =>
    configDir ? inFolder(configDir, "remove", [sessionID]) : helpers.remove(sessionID),
}

export class WorkerUnavailableError extends Error {}

// The SDK's session helpers read CLAUDE_CONFIG_DIR from process.env and take no folder option.
export const helpers = {
  fork: ClaudeFork.create,
  remove: async (sessionID: string) => {
    const { deleteSession } = await ClaudeSDK.load()
    await deleteSession(sessionID)
  },
}

type HelperResult<Name extends keyof typeof helpers> = Awaited<ReturnType<(typeof helpers)[Name]>>

// A worker has its own process.env, so the helpers see another folder without changing it for other sessions.
async function inFolder<Name extends keyof typeof helpers>(
  configDir: string,
  name: Name,
  args: Parameters<(typeof helpers)[Name]>,
): Promise<HelperResult<Name>> {
  const { Worker } = await import("node:worker_threads")
  const worker = new Worker(new URL("./claude-folder-worker.js", import.meta.url), {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    workerData: { name, args },
  })
  return new Promise<HelperResult<Name>>((resolve, reject) => {
    worker.once("message", (reply) => {
      if ("error" in reply) reject(reply.error)
      else resolve(reply.value)
    })
    // The worker reports helper failures as messages, so an error here means it could not start.
    worker.once("error", (cause) =>
      reject(new WorkerUnavailableError("Claude folder worker failed to start", { cause })),
    )
    worker.once("exit", () => reject(new Error(`Claude session helper ${name} exited without a result`)))
  }).finally(() => worker.terminate())
}
