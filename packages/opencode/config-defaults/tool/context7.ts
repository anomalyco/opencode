import { tool } from "@opencode-ai/plugin"
import { spawn } from "child_process"

// Run `npx ctx7 ...` and capture combined output. Uses an args array (no shell
// quoting issues) and npx.cmd on Windows.
function ctx7(args: string[], timeoutMs = 60000): Promise<{ code: number; out: string }> {
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
    child.stdout?.on("data", (d) => (out += d.toString()))
    child.stderr?.on("data", (d) => (out += d.toString()))
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: 1, out: out + "\n" + String(e) })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 0, out })
    })
  })
}

export default tool({
  description: `Fetch REAL, up-to-date documentation for a library/framework/SDK/API via Context7 (ctx7).

USE THIS whenever the request involves a specific library, framework, SDK, tool or API:
how to use X, X's API/options, configuration for X, version-specific behavior, code examples.
Prefer it over guessing from memory, which can be outdated.

Inputs:
- library: a name (e.g. "react", "next.js", "drizzle") OR a Context7 library id (e.g. "/facebook/react").
- query: what you want to know (e.g. "useEffect cleanup", "route handlers", "migrations").

If a name is given it is resolved to a Context7 id first, then docs are fetched.
If ctx7 reports it needs authentication, run \`npx ctx7 login\` once in a terminal.`,
  args: {
    library: tool.schema.string().describe("Library name (e.g. 'react') or Context7 id (e.g. '/facebook/react')"),
    query: tool.schema.string().describe("What you want to know about the library"),
  },
  async execute(args) {
    const isId = args.library.trim().startsWith("/")
    let libraryId = args.library.trim()
    let resolutionNote = ""

    if (!isId) {
      const r = await ctx7(["library", args.library, args.query])
      const resolution = r.out.trim()
      const match = resolution.match(/\/[A-Za-z0-9_.@-]+\/[A-Za-z0-9_.@/-]+/)
      if (!match) {
        return `Could not resolve "${args.library}" to a Context7 library id.\n\nctx7 output:\n${resolution || "(no output)"}`
      }
      libraryId = match[0]
      resolutionNote = `Resolved "${args.library}" -> ${libraryId}\n\n`
    }

    const d = await ctx7(["docs", libraryId, args.query])
    const docs = d.out.trim()
    if (!docs) {
      return `${resolutionNote}No documentation returned for ${libraryId} ("${args.query}").`
    }
    return `${resolutionNote}Context7 docs for ${libraryId} - "${args.query}":\n\n${docs}`
  },
})
