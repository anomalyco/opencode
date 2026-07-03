import { spawn } from "child_process"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const DESCRIPTION = [
  "Fetch REAL, up-to-date documentation for a library/framework/SDK/API via Context7 (ctx7).",
  "",
  "USE THIS whenever the request involves a specific library, framework, SDK, tool or API:",
  "how to use X, X's API/options, configuration for X, version-specific behavior, code examples.",
  "Prefer it over guessing from memory, which can be outdated.",
  "",
  "Inputs:",
  "- library: a name (e.g. \"react\", \"next.js\") OR a Context7 id (e.g. \"/facebook/react\").",
  "- query: what you want to know (e.g. \"useEffect cleanup\", \"route handlers\").",
  "",
  "If a name is given it is resolved to a Context7 id first, then docs are fetched.",
  "If ctx7 reports it needs authentication, run `npx ctx7 login` once in a terminal.",
].join("\n")

export const Parameters = Schema.Struct({
  library: Schema.String.annotate({
    description: "Library name (e.g. 'react') or Context7 id (e.g. '/facebook/react')",
  }),
  query: Schema.String.annotate({ description: "What you want to know about the library" }),
})

function ctx7(args: string[], abort: AbortSignal, timeoutMs = 60000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "npx.cmd" : "npx"
    const child = spawn(cmd, ["ctx7", ...args], { windowsHide: true })
    let out = ""
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      resolve({ code: 124, out: out + "\n[ctx7 timed out]" })
    }, timeoutMs)
    const onAbort = () => {
      try {
        child.kill()
      } catch {}
    }
    abort.addEventListener("abort", onAbort, { once: true })
    child.stdout?.on("data", (d) => (out += d.toString()))
    child.stderr?.on("data", (d) => (out += d.toString()))
    child.on("error", (e) => {
      clearTimeout(timer)
      abort.removeEventListener("abort", onAbort)
      resolve({ code: 1, out: out + "\n" + String(e) })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      abort.removeEventListener("abort", onAbort)
      resolve({ code: code ?? 0, out })
    })
  })
}

export const Context7Tool = Tool.define(
  "context7",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const isId = params.library.trim().startsWith("/")
          let libraryId = params.library.trim()
          let resolutionNote = ""

          if (!isId) {
            const r = yield* Effect.promise(() => ctx7(["library", params.library, params.query], ctx.abort))
            const resolution = r.out.trim()
            const match = resolution.match(/\/[A-Za-z0-9_.@-]+\/[A-Za-z0-9_.@/-]+/)
            if (!match) {
              return {
                title: `context7 ${params.library}`,
                metadata: { resolved: false, libraryId: "" },
                output: `Could not resolve "${params.library}" to a Context7 library id.\n\nctx7 output:\n${
                  resolution || "(no output)"
                }`,
              }
            }
            libraryId = match[0]
            resolutionNote = `Resolved "${params.library}" -> ${libraryId}\n\n`
          }

          const d = yield* Effect.promise(() => ctx7(["docs", libraryId, params.query], ctx.abort))
          const docs = d.out.trim()
          return {
            title: `context7 ${libraryId}`,
            metadata: { resolved: true, libraryId },
            output: docs
              ? `${resolutionNote}Context7 docs for ${libraryId} - "${params.query}":\n\n${docs}`
              : `${resolutionNote}No documentation returned for ${libraryId} ("${params.query}").`,
          }
        }),
    }
  }),
)
