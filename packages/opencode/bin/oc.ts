#!/usr/bin/env bun
// oc — Calls back into the running openCode instance from bash scripts.
// Deterministic tool calls use the shell fast-path (bin/oc); this binary
// handles complex operations: prompt, agent, todo, status, and tool fallback.

import { Effect, Exit, Cause, Option, Schema } from "effect"
import { resolve, normalize } from "path"

class ServerError extends Schema.TaggedErrorClass<ServerError>()("ServerError", { message: Schema.String }) {}
class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}
class ApiError extends Schema.TaggedErrorClass<ApiError>()("ApiError", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

interface ExecBody extends Record<string, unknown> {
  prompt: string
  system?: string
  agent?: string
  messageID?: string
  model?: { providerID: string; modelID: string }
  files?: Array<{ filename: string; mime: string; url: string }>
}

interface ToolBody extends Record<string, unknown> {
  name: string
  args: Record<string, unknown>
  agent: string
  messageID?: string
}

interface StatusBody extends Record<string, unknown> {
  message: string
  messageID?: string
}

const server = process.env.OPENCODE_SERVER_URL
const sid = process.env.OPENCODE_SESSION_ID
const dir = process.env.OPENCODE_DIRECTORY ?? process.cwd()
const msg = process.env.OPENCODE_MESSAGE_ID
const quiet = process.env.OPENCODE_QUIET === "1"
const noTimeout = process.env.OPENCODE_NO_TIMEOUT === "1"

// Path resolution: resolve relative paths against cwd; reject empty strings.
// Absolute paths (e.g. /tmp/foo) are passed through unchanged — the server-side
// tool already enforces permissions via Permission.ask.
const toPath = Effect.fn("oc.toPath")((p: string) =>
  Effect.gen(function* () {
    if (!p || p.trim() === "") return yield* new ValidationError({ message: "Invalid path: empty or null" })
    return resolve(dir, normalize(p))
  }),
)

const marker = "\x00OC_FILE\x00:"
const trunc = "\x00OC_TRUNCATED\x00:"

const mimes: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
}

const log = (label: string) => {
  if (!quiet) process.stderr.write(`\x1b[2m[oc] ${label}\x1b[0m\n`)
}

const parse = (model: string) => {
  const i = model.indexOf("/")
  if (i < 0) return undefined
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) }
}

const api = Effect.fn("oc.api")((method: string, path: string, body?: Record<string, unknown>) =>
  Effect.gen(function* () {
    if (!server)
      return yield* new ServerError({
        message: "OPENCODE_SERVER_URL not set — are you running inside an openCode bash tool?",
      })

    const res = yield* Effect.tryPromise({
      try: () => {
        // Tool paths: 60s timeout (deterministic ops should be fast).
        //   Set OPENCODE_TOOL_TIMEOUT_MS env var to override in tests.
        // Exec paths: configurable timeout, default 30 minutes (Ralph loops can run arbitrarily long).
        //   Set OPENCODE_EXEC_TIMEOUT_MS env var to override in tests.
        const exec = path.includes("/exec")
        const ms = exec
          ? parseInt(process.env.OPENCODE_EXEC_TIMEOUT_MS ?? "1800000", 10)
          : parseInt(process.env.OPENCODE_TOOL_TIMEOUT_MS ?? "60000", 10)
        const signal = AbortSignal.timeout(ms)

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-opencode-directory": encodeURIComponent(dir),
        }

        // Disable provider timeout for any oc command (can be long-running)
        if (noTimeout) {
          headers["x-opencode-no-timeout"] = "true"
        }

        return fetch(new URL(path, server).toString(), {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal,
          // Disable Bun's native TCP-level timeout for exec ops — see timeoutOpt
          ...timeoutOpt(path),
        } as RequestInit)
      },
      catch: (e) => new ApiError({ message: e instanceof Error ? e.message : String(e) }),
    })

    if (!res.ok) {
      const text = yield* Effect.promise(() => res.text().catch(() => ""))
      return yield* new ApiError({
        message: `server returned HTTP ${res.status}${text ? `: ${text}` : ""}`,
        status: res.status,
      })
    }

    return yield* Effect.tryPromise({
      // Strip keepalive markers injected by the server to prevent HTTP idle timeouts.
      try: () => res.text().then((t) => t.replaceAll("\x00OC_KEEPALIVE\x00", "")),
      catch: (e) => new ApiError({ message: e instanceof Error ? e.message : String(e) }),
    })
  }),
)

const tool = Effect.fn("oc.tool")((name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const body: ToolBody = {
      name,
      args,
      agent: process.env.OPENCODE_AGENT ?? "build",
      ...(msg ? { messageID: msg } : {}),
    }
    return yield* api("POST", `/session/${sid}/tool`, body)
  }),
)

const stdin = Effect.fn("oc.stdin")(() =>
  Effect.gen(function* () {
    if (process.stdin.isTTY) return ""
    return yield* Effect.tryPromise({
      try: () => new Response(Bun.stdin.stream()).text(),
      catch: (e) => new ApiError({ message: e instanceof Error ? e.message : String(e) }),
    })
  }),
)

const prompt = Effect.fn("oc.prompt")((rest: string[]) =>
  Effect.gen(function* () {
    let system: string | undefined
    let model: string | undefined
    let via: string | undefined
    const files: string[] = []
    const args: string[] = []

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-s" || rest[i] === "--system") {
        if (i + 1 < rest.length) system = rest[++i]
        continue
      }
      if (rest[i] === "-m" || rest[i] === "--model") {
        if (i + 1 < rest.length) model = rest[++i]
        continue
      }
      if (rest[i] === "-a" || rest[i] === "--agent") {
        if (i + 1 < rest.length) via = rest[++i]
        continue
      }
      if (rest[i] === "-f" || rest[i] === "--file") {
        if (i + 1 < rest.length) files.push(rest[++i])
        continue
      }
      args.push(rest[i])
    }

    const raw = yield* stdin()
    const lines: string[] = []
    const piped: string[] = []

    if (raw) {
      for (const line of raw.split("\n")) {
        if (line.startsWith(marker)) {
          piped.push(line.substring(marker.length))
          continue
        }
        lines.push(line)
      }
    }

    const input = lines.join("\n").trim()
    const text = input ? `${input}\n\n${args.join(" ")}` : args.join(" ")

    if (!text.trim()) {
      return yield* new ValidationError({ message: "oc prompt: no prompt text provided" })
    }

    const body: ExecBody = { prompt: text }
    if (system) body.system = system
    if (via) body.agent = via
    if (msg) body.messageID = msg

    if (model) {
      const parsed = parse(model)
      if (!parsed) return yield* new ValidationError({ message: "oc prompt: model must be provider/model" })
      body.model = parsed
    }

    const paths = [...files, ...piped]
    if (paths.length > 0) {
      body.files = yield* Effect.all(
        paths.map((fp) =>
          Effect.gen(function* () {
            const safe = yield* toPath(fp)
            const buf = yield* Effect.tryPromise({
              try: () => Bun.file(safe).arrayBuffer(),
              catch: (e) =>
                new ApiError({ message: `Failed to read file ${fp}: ${e instanceof Error ? e.message : String(e)}` }),
            })

            // Validate file size (max 10MB)
            if (buf.byteLength > 10 * 1024 * 1024) {
              return yield* new ValidationError({
                message: `oc prompt: file ${fp} too large (${Math.round(buf.byteLength / 1024 / 1024)}MB, max 10MB)`,
              })
            }

            const mime = mimes[fp.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream"
            return {
              filename: fp.split("/").pop() ?? fp,
              mime,
              url: `data:${mime};base64,${Buffer.from(buf).toString("base64")}`,
            }
          }),
        ),
      )
    }

    log(
      system
        ? `prompt -s "${system.substring(0, 30)}" "${args.join(" ").substring(0, 50)}"`
        : `prompt "${args.join(" ").substring(0, 60)}"`,
    )
    process.stdout.write(yield* api("POST", `/session/${sid}/exec`, body))
  }),
)

const check = Effect.fn("oc.check")((rest: string[]) =>
  Effect.gen(function* () {
    let model: string | undefined
    const args: string[] = []

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-m" || rest[i] === "--model") {
        if (i + 1 < rest.length) model = rest[++i]
        continue
      }
      args.push(rest[i])
    }

    const question = yield* stdin().pipe(Effect.map((s) => (s ? `${s}\n\n${args.join(" ")}` : args.join(" "))))

    if (!question.trim()) {
      return yield* new ValidationError({ message: "oc check: no question provided" })
    }

    log(`check "${question.substring(0, 60)}"`)

    const sentinel = "NO_ISSUES_FOUND"
    const body: ExecBody = {
      prompt: [
        question,
        "",
        `If you find issues, list them with file paths and line numbers.`,
        `If there are NO issues, respond with exactly: ${sentinel}`,
      ].join("\n"),
    }
    if (msg) body.messageID = msg

    if (model) {
      const parsed = parse(model)
      if (!parsed) return yield* new ValidationError({ message: "oc check: model must be provider/model" })
      body.model = parsed
    }

    const response = yield* api("POST", `/session/${sid}/exec`, body)

    const trimmed = response.trim()
    const clean = trimmed.includes(sentinel)
    if (!clean && trimmed) process.stdout.write(trimmed + "\n")
    return !clean
  }),
)

const program = Effect.gen(function* () {
  if (!server) {
    return yield* new ServerError({
      message: "OPENCODE_SERVER_URL not set — are you running inside an openCode bash tool?",
    })
  }
  if (!sid) {
    return yield* new ServerError({
      message: "OPENCODE_SESSION_ID not set — are you running inside an openCode bash tool?",
    })
  }

  const cmd = process.argv[2]
  const rest = process.argv.slice(3)

  switch (cmd) {
    case "prompt": {
      yield* prompt(rest)
      break
    }

    case "tool": {
      const name = rest[0]
      const tail = rest.slice(1)
      if (!name) {
        return yield* new ValidationError({
          message: "oc tool: no tool name. Available: read, write, edit, grep, glob, batch, bash",
        })
      }
      const exec = (args: Record<string, unknown>) => {
        log(`tool ${name} ${tail[0]?.substring(0, 60) ?? ""}`)
        return Effect.gen(function* () {
          const result = yield* tool(name, args)
          process.stdout.write(
            result
              .split("\n")
              .filter((line) => {
                if (line.startsWith(trunc)) {
                  process.stderr.write(`\x1b[33m[oc] ${line.substring(trunc.length)}\x1b[0m\n`)
                  return false
                }
                return true
              })
              .join("\n"),
          )
        })
      }
      switch (name) {
        case "read": {
          if (!tail[0]) {
            return yield* new ValidationError({ message: "oc tool read: file path required" })
          }
          const ni = tail.indexOf("-n")
          const limit =
            ni >= 0 && ni + 1 < tail.length
              ? (() => {
                  const n = parseInt(tail[ni + 1], 10)
                  return Number.isNaN(n) ? undefined : n
                })()
              : undefined
          yield* exec({ filePath: yield* toPath(tail[0]), limit })
          break
        }
        case "write": {
          if (!tail[0]) {
            return yield* new ValidationError({ message: "oc tool write: file path required" })
          }
          const content = yield* stdin()
          yield* exec({ filePath: yield* toPath(tail[0]), content })
          break
        }
        case "edit": {
          if (!tail[0]) {
            return yield* new ValidationError({ message: "oc tool edit: file path required" })
          }
          let old = ""
          let rep = ""
          for (let i = 1; i < tail.length; i++) {
            if ((tail[i] === "--old" || tail[i] === "-o") && i + 1 < tail.length) {
              old = tail[++i]
              continue
            }
            if ((tail[i] === "--new" || tail[i] === "-n") && i + 1 < tail.length) {
              rep = tail[++i]
              continue
            }
          }
          yield* exec({ filePath: yield* toPath(tail[0]), oldString: old, newString: rep })
          break
        }
        case "grep":
          if (!tail[0]) {
            return yield* new ValidationError({ message: "oc tool grep: pattern required" })
          }
          yield* exec({ pattern: tail[0], path: yield* toPath(tail[1] ?? ".") })
          break
        case "glob":
          if (!tail[0]) {
            return yield* new ValidationError({ message: "oc tool glob: pattern required" })
          }
          yield* exec({ pattern: tail[0], path: tail[1] ? yield* toPath(tail[1]) : undefined })
          break
        case "bash": {
          const command = tail.join(" ")
          if (!command.trim()) {
            return yield* new ValidationError({ message: "oc tool bash: command required" })
          }
          yield* exec({ command: command.trim(), description: `oc bash: ${command.substring(0, 50)}` })
          break
        }
        case "batch": {
          const content = yield* stdin()
          if (!content.trim()) {
            return yield* new ValidationError({ message: "oc tool batch: no JSON content provided" })
          }
          // Limit JSON size to prevent DoS
          if (content.length > 1024 * 1024) {
            // 1MB limit
            return yield* new ValidationError({ message: "oc tool batch: JSON too large (max 1MB)" })
          }
          const parsed = yield* Effect.try({
            try: () => {
              const data = JSON.parse(content)
              // Basic structure validation
              if (!Array.isArray(data)) {
                throw new Error("Expected array of tool calls")
              }
              return data
            },
            catch: (e) =>
              new ValidationError({
                message: `oc tool batch: invalid JSON - ${e instanceof Error ? e.message : String(e)}`,
              }),
          })
          yield* exec({ tool_calls: parsed })
          break
        }
        default:
          yield* exec(Object.fromEntries(tail.map((a, i) => [i === 0 ? "input" : `arg${i}`, a])))
      }
      break
    }

    case "agent": {
      const type = rest[0]
      const tail = rest.slice(1)
      if (!type) {
        return yield* new ValidationError({ message: "oc agent: usage: oc agent <type> <prompt>" })
      }
      const text = yield* stdin().pipe(Effect.map((s) => (s ? `${s}\n\n${tail.join(" ")}` : tail.join(" "))))
      if (!text.trim()) {
        return yield* new ValidationError({ message: "oc agent: no prompt text" })
      }
      log(`agent ${type} "${tail.join(" ").substring(0, 50)}"`)
      const body: ExecBody = { prompt: text, agent: type }
      if (msg) body.messageID = msg
      process.stdout.write(yield* api("POST", `/session/${sid}/exec`, body))
      break
    }

    case "todo": {
      const sub = rest[0]
      const tail = rest.slice(1)
      switch (sub) {
        case "add": {
          const content = tail.join(" ")
          if (!content.trim()) {
            return yield* new ValidationError({ message: "oc todo add: no content" })
          }
          log(`todo add "${content.substring(0, 50)}"`)
          process.stdout.write(yield* api("POST", `/session/${sid}/todo`, { content, status: "pending" }))
          break
        }
        case "list":
        case "read": {
          process.stdout.write(yield* api("GET", `/session/${sid}/todo`))
          break
        }
        case "done": {
          const idx = parseInt(tail[0], 10)
          if (isNaN(idx) || idx < 1) {
            return yield* new ValidationError({ message: "oc todo done: provide 1-based index" })
          }
          const response = yield* api("GET", `/session/${sid}/todo`)
          const parsed = yield* Effect.try({
            try: () => JSON.parse(response) as { content: string; status: string; priority: string }[],
            catch: () => new ValidationError({ message: "oc todo done: invalid response from server" }),
          })
          if (idx > parsed.length) {
            return yield* new ValidationError({
              message: `oc todo done: index ${idx} out of range (max: ${parsed.length})`,
            })
          }
          parsed[idx - 1].status = "completed"
          log(`todo done ${idx} ✓ ${parsed[idx - 1].content.substring(0, 40)}`)
          yield* api("PUT", `/session/${sid}/todo`, { todos: parsed })
          log(`Marked todo ${idx} as completed: ${parsed[idx - 1].content}`)
          break
        }
        case "clear": {
          yield* api("PUT", `/session/${sid}/todo`, { todos: [] })
          log("Cleared all todos")
          break
        }
        default:
          return yield* new ValidationError({
            message: `oc todo: unknown '${sub}'. Usage: oc todo <add|list|done|clear>`,
          })
      }
      break
    }

    case "status": {
      const message = rest.join(" ")
      if (!message.trim()) {
        return yield* new ValidationError({ message: "oc status: no message" })
      }
      log(`status: ${message}`)
      const body: StatusBody = { message }
      if (msg) body.messageID = msg
      // Fire-and-forget: post status to server for TUI visibility.
      // We do NOT await the response — oc status must return immediately.
      fetch(new URL(`/session/${sid}/status`, server).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-opencode-directory": encodeURIComponent(dir) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      }).catch(() => {})
      break
    }

    case "check": {
      process.exit((yield* check(rest)) ? 0 : 1)
      break
    }

    case "help":
    case "--help":
    case "-h":
      console.log(`oc — openCode CLI callback tool

AI JUDGMENT (non-deterministic):
  oc prompt "question"                     AI response on stdout
  oc prompt -s "system" "question"         Dynamic specialist
  oc prompt -m provider/model "question"   Specific model
  oc prompt -f file.pdf "analyze"          Attach file (multimodal)
  cat file | oc prompt "analyze"           Context from stdin

DETERMINISTIC TOOLS:
  oc tool read <path>                      Read file → stdout
  echo "content" | oc tool write <path>    Write stdin → file
  oc tool edit <path> --old "x" --new "y"  Edit file
  oc tool grep "pattern" [path]            Search → stdout
  oc tool glob "pattern" [path]            Find files → stdout
  oc tool batch                            Execute JSON tool calls from stdin

ASSESSMENT + BOOLEAN (grep pattern — findings on stdout, boolean on exit code):
  oc check "question"                      Assessment → stdout, exit 0 (issues found) / 1 (clean)
  oc check -m provider/model "question"    Use specific model for assessment
  data | oc check "question"               Piped context
  while a=\$(oc check "issues?"); do        Loop pattern: capture assessment,
    echo "\$a" | oc prompt "fix"            pipe findings to fixer
  done

SUBAGENTS:
  oc agent <type> "prompt"                 Spawn subagent

STATE:
  oc todo add|list|done|clear              Manage todos
  oc status "message"                      Progress update (bold, visible in TUI)`)
      break

    default:
      console.error(`oc: unknown command '${cmd ?? ""}' — run 'oc help'`)
      process.exit(1)
  }
})

// Exported for testing: returns { timeout: false } for exec paths to disable Bun's
// native TCP-level timeout so it doesn't interfere with AbortSignal.timeout(ms).
// Tool paths return {} (Bun default timeout is fine, AbortSignal is the primary guard).
export const timeoutOpt = (path: string): { timeout?: false } => (path.includes("/exec") ? { timeout: false } : {})

const isKnown = (err: unknown): err is { _tag: string; message: string } => {
  if (typeof err !== "object" || err === null) return false
  const obj = err as Record<string, unknown>
  return (
    (obj._tag === "ValidationError" || obj._tag === "ServerError" || obj._tag === "ApiError") &&
    typeof obj.message === "string"
  )
}

if (import.meta.main)
  Effect.runPromiseExit(program).then((exit) => {
    if (Exit.isSuccess(exit)) return
    // Check typed failures first (from yield* new MyError(...))
    const failure = Cause.findErrorOption(exit.cause)
    if (Option.isSome(failure) && isKnown(failure.value)) {
      console.error(failure.value.message)
      process.exit(1)
    }
    // Also check defects (unexpected errors surfaced via Cause.squash)
    const squashed = Cause.squash(exit.cause)
    if (isKnown(squashed)) {
      console.error(squashed.message)
      process.exit(1)
    }
    console.error(`oc: unexpected error: ${squashed instanceof Error ? squashed.message : String(squashed)}`)
    process.exit(1)
  })
