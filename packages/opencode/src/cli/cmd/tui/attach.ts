import { cmd } from "../cmd"
import { UI } from "@/cli/ui"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { errorMessage } from "@/util/error"
import { validateSession } from "./validate-session"
import { ServerAuth } from "@/server/auth"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import type { EventSource } from "./context/sdk"

// Subscribe to the server's /global/event SSE stream so externally-triggered
// session activity (e.g. wakes via POST /session/<id>/prompt_async from another
// peer) renders in the attach client's TUI.
//
// Without this, attach passes `events: undefined` to the SDKProvider, which is
// supposed to fall back to startSSE() internally. In practice the fallback is
// silent on failure (the IIFE catches everything) — explicit wiring here makes
// the subscription observable and lifts errors to the user.
function createAttachEventSource(opts: {
  url: string
  directory?: string
  headers?: RequestInit["headers"]
}): EventSource {
  const sdk = createOpencodeClient({
    baseUrl: opts.url,
    directory: opts.directory,
    headers: opts.headers,
  })
  return {
    subscribe: async (handler) => {
      const ctrl = new AbortController()
      ;(async () => {
        // Single-pass — caller's onCleanup aborts; SDKProvider does retry
        // internally if it owns the subscription, but here we deliberately
        // keep it simple and one-shot. Reconnect on transient failures would
        // be a follow-up.
        const events = await sdk.global.event({ signal: ctrl.signal, sseMaxRetryAttempts: 0 })
        for await (const event of events.stream as AsyncIterable<GlobalEvent>) {
          if (ctrl.signal.aborted) break
          handler(event)
        }
      })().catch(() => {})
      return () => ctrl.abort()
    },
  }
}

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to OPENCODE_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to OPENCODE_SERVER_USERNAME or 'opencode')",
      }),
  handler: async (args) => {
    const unguard = win32InstallCtrlCGuard()
    try {
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      const directory = (() => {
        if (!args.dir) return undefined
        try {
          process.chdir(args.dir)
          return process.cwd()
        } catch {
          // If the directory doesn't exist locally (remote attach), pass it through.
          return args.dir
        }
      })()
      const headers = ServerAuth.headers({ password: args.password, username: args.username })
      const config = await TuiConfig.get()
      const { tui } = await import("./app")

      try {
        await validateSession({
          url: args.url,
          sessionID: args.session,
          directory,
          headers,
        })
      } catch (error) {
        UI.error(errorMessage(error))
        process.exitCode = 1
        return
      }

      await tui({
        url: args.url,
        config,
        args: {
          continue: args.continue,
          sessionID: args.session,
          fork: args.fork,
        },
        directory,
        headers,
        events: createAttachEventSource({ url: args.url, directory, headers }),
      })
    } finally {
      unguard?.()
    }
  },
})
