import { Cause, Effect, Exit, Option, Ref, Schema } from "effect"
import { spawn, type ChildProcess } from "child_process"
import path from "path"
import { pathToFileURL } from "url"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"
import DRIVER_SOURCE from "./browser-driver.mjs.txt"
import { BrowserRecording } from "./browser-recording"

/**
 * Browser tool — Fase 4 (browser agent nativo). Drives one headless Chromium
 * session per workspace instance and returns evidence (screenshots as
 * attachments, console/network drains) for the verification loop:
 * modify → start the app → open the browser → test → report → fix → repeat.
 *
 * The tool runs under bun, but Playwright only works under Node.js (its
 * launcher and WebSocket client hang under the bun runtime — verified, while
 * Node.js launches Chromium in well under a second). `open` therefore writes
 * a small Node.js driver (`browser-driver.mjs.txt`) to the temp dir and spawns
 * `node driver.mjs <playwright-entry> <scratch-dir>`; every action is
 * validated and authorized here, then executed in the driver over a
 * JSON-lines stdio protocol. The driver returns ready results (title/output/
 * attachments), exits after "close", and closes the browser when stdin closes.
 *
 * Playwright stays an OPTIONAL dependency: it is resolved through
 * Bun.resolveSync at open, and a missing package (or missing Node.js) fails
 * with honest installation/BLOCKED instructions instead of pretending a
 * browser exists (Fase 40 — no simulated results).
 *
 * - One session per instance (the registry creates this tool per directory);
 *   `open` is idempotent, `close` is idempotent.
 * - console/network/downloads evidence lives in the driver and DRAINS on read
 *   so it is never repeated across reads.
 * - `open`, `goto`, and `eval` request the "browser" permission (pattern =
 *   URL); in-page actions run inside the already-approved session.
 *
 * Fase 5 (browser recording): the driver records every executed step (params,
 * result/error, URL, timestamp, screenshot) plus cumulative console/network
 * buffers. `recording` exports that session as the "Browser Test Recording"
 * artifact (self-contained HTML evidence + JSON recording); `replay` re-runs a
 * recorded session step by step through this same switch, so validation and
 * permissions apply exactly as they did live. Replayed steps are marked in the
 * protocol so they never rewrite the original recording.
 */

export const Parameters = Schema.Struct({
  action: Schema.Literals([
    "open",
    "close",
    "goto",
    "back",
    "forward",
    "click",
    "fill",
    "select",
    "upload",
    "screenshot",
    "snapshot",
    "eval",
    "console",
    "network",
    "downloads",
    "viewport",
    "wait",
    "recording",
    "replay",
  ]).annotate({ description: "The browser operation to perform." }),
  url: Schema.optional(Schema.String).annotate({
    description: "URL for goto; optional immediate navigation on open.",
  }),
  selector: Schema.optional(Schema.String).annotate({
    description: "CSS selector for click/fill/select/upload/wait.",
  }),
  value: Schema.optional(Schema.String).annotate({
    description: "Text for fill, option value or label for select, absolute file path for upload.",
  }),
  code: Schema.optional(Schema.String).annotate({ description: "JavaScript expression for eval (page context)." }),
  path: Schema.optional(Schema.String).annotate({
    description: "Destination file for screenshot; recording file to replay for replay.",
  }),
  width: Schema.optional(Schema.Number).annotate({ description: "Viewport width for viewport (requires height)." }),
  height: Schema.optional(Schema.Number).annotate({ description: "Viewport height for viewport (requires width)." }),
  fullPage: Schema.optional(Schema.Boolean).annotate({
    description: "Capture the full scrollable page (screenshot).",
  }),
  headless: Schema.optional(Schema.Boolean).annotate({
    description: "Run without a visible window on open (default true).",
  }),
  timeoutMs: Schema.optional(Schema.Number).annotate({
    description: "Timeout for navigation and interaction actions (default 30000).",
  }),
})

// A successful driver reply. The driver owns page access, so it formats the
// final title/output (and the base64 screenshot attachment) itself.
interface RpcResult {
  readonly title: string
  readonly output: string
  attachments?: Array<{ type: "file"; mime: string; url: string }>
}

// One Node.js driver process per instance. Replies correlate by id (they may
// interleave), `stderr` keeps a tail so a crashed driver can report honestly,
// and `exited` distinguishes "never opened" from "session died".
interface Session {
  readonly child: ChildProcess
  readonly pending: Map<number, { resolve: (result: RpcResult) => void; reject: (error: Error) => void }>
  nextId: number
  exited: boolean
  exitCode: number | null
  stderr: string
}

const attempt = <A>(label: string, task: () => Promise<A>) =>
  Effect.promise(() =>
    task().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`browser ${label} failed: ${detail}`)
    }),
  )

const requireField = <T>(action: string, name: string, value: T | undefined): T => {
  if (value === undefined) throw new Error(`The browser action "${action}" requires "${name}".`)
  return value
}

// Resolves the optional playwright package to the exact file the driver must
// import. Fails with actionable instructions instead of a resolution error
// (the driver lives in the temp dir, so it cannot resolve node_modules itself).
const resolvePlaywright = (): string => {
  try {
    return pathToFileURL(Bun.resolveSync("playwright", import.meta.dirname)).href
  } catch {
    throw new Error(
      'Browser automation is unavailable: the optional "playwright" package is not installed. ' +
        "Install it with `bun add playwright` and its browsers with `bunx playwright install chromium`, " +
        "then retry the action.",
    )
  }
}

// Scratch dir shared by the tool and the driver: the driver source, persisted
// recordings (recording.json) and exported Browser Test Recording artifacts
// all live here (system temp, cleaned by the OS).
const SCRATCH = path.join(Global.Path.tmp, "opencode-browser")

// Replay is bounded: a recording from a long session cannot pin the agent on
// timeouts (each failing step may take up to timeoutMs), and the summary lines
// stay short enough for tool output.
const MAX_REPLAY_STEPS = 100
const MAX_REPLAY_LINES = 40

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    const session = yield* Ref.make<Session | undefined>(undefined)
    // True while a replay loop drives the session. It marks each driver
    // message (`replay: true`) so replayed steps re-run for evidence without
    // being recorded over the original session. Closure-scoped (not module
    // state) because the tool instance owns one session at a time.
    let replaying = false

    const send = (current: Session, action: string, params: Schema.Schema.Type<typeof Parameters>) =>
      new Promise<RpcResult>((resolve, reject) => {
        if (current.exited) {
          reject(new Error('Browser session is not running. Run action "open" to start a new session.'))
          return
        }
        const id = ++current.nextId
        current.pending.set(id, { resolve, reject })
        const payload = JSON.stringify({ id, action, params, ...(replaying ? { replay: true } : {}) })
        current.child.stdin?.write(payload + "\n", (error) => {
          if (!error) return
          current.pending.delete(id)
          reject(new Error(`browser ${action} failed: browser driver connection error: ${error.message}`))
        })
      })

    // Spawns a fresh driver: resolve playwright first (honest failure before
    // any process exists), write the embedded source to the temp dir, then
    // start `node` with protocol stdio. A dead previous session is replaced.
    const startDriver = Effect.gen(function* () {
      const entry = resolvePlaywright()
      const directory = SCRATCH
      const driverPath = path.join(directory, "driver.mjs")
      yield* Effect.promise(() => Bun.write(driverPath, DRIVER_SOURCE))
      const child = spawn("node", [driverPath, entry, directory], { stdio: ["pipe", "pipe", "pipe"] })
      const input = child.stdin
      const output = child.stdout
      const errors = child.stderr
      if (input === null || output === null || errors === null) {
        child.kill()
        throw new Error("browser driver failed to start: node stdio pipes are unavailable.")
      }
      const current: Session = { child, pending: new Map(), nextId: 0, exited: false, exitCode: null, stderr: "" }

      const rejectAll = (detail: string) => {
        current.exited = true
        const tail = current.stderr.trim().split("\n").slice(-5).join("\n").trim()
        const error = new Error(detail + (tail ? ` Driver output: ${tail}` : ""))
        for (const waiter of current.pending.values()) waiter.reject(error)
        current.pending.clear()
      }

      // Correlates one reply line to its pending send. Malformed lines are
      // protocol noise (e.g. a stray launcher log), never a response.
      const route = (line: string) => {
        let message: { id?: unknown; ok?: unknown; result?: RpcResult; error?: unknown }
        try {
          message = JSON.parse(line)
        } catch {
          return
        }
        if (typeof message.id !== "number") return
        const waiter = current.pending.get(message.id)
        if (waiter === undefined) return
        current.pending.delete(message.id)
        if (message.ok === true && message.result !== undefined) {
          waiter.resolve(message.result)
          return
        }
        waiter.reject(
          new Error(typeof message.error === "string" ? message.error : "browser driver returned a malformed response"),
        )
      }

      let buffer = ""
      output.setEncoding("utf8")
      output.on("data", (chunk: string) => {
        buffer += chunk
        let index = buffer.indexOf("\n")
        while (index >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          if (line.trim() !== "") route(line)
          index = buffer.indexOf("\n")
        }
      })
      errors.setEncoding("utf8")
      errors.on("data", (chunk: string) => {
        current.stderr = (current.stderr + chunk).slice(-4000)
      })
      input.on("error", (error) => rejectAll(`Browser driver connection lost: ${error.message}.`))
      child.on("error", (error) =>
        rejectAll(
          `Browser driver failed to start: ${error.message}. The browser needs a working Node.js process because ` +
            "playwright does not run under bun — install Node.js or treat the browser as BLOCKED.",
        ),
      )
      // 'close' (not 'exit') so buffered replies are routed before pending
      // sends reject; 'exit' can fire while stdio is still draining.
      child.on("close", (code) => {
        current.exitCode = code
        rejectAll(`Browser driver exited with code ${code ?? "unknown"}. Run action "open" to start a new session.`)
      })

      const previous = yield* Ref.get(session)
      if (previous !== undefined) previous.child.kill()
      yield* Ref.set(session, current)
      return current
    })

    const requireSession = (action: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(session)
        if (current === undefined)
          throw new Error(`The browser action "${action}" requires an open browser session. Call action "open" first.`)
        if (current.exited)
          throw new Error(
            `The browser action "${action}" cannot run: the driver exited with code ${current.exitCode ?? "unknown"}. ` +
              'Run action "open" to start a new session.',
          )
        return current
      })

    const ask = (ctx: Tool.Context, action: string, url?: string) =>
      ctx.ask({
        permission: "browser",
        patterns: [url ?? "*"],
        always: ["*"],
        metadata: { action, url: url ?? "" },
      })

    // Resolves the recording a replay should run: an explicit file wins,
    // otherwise the live driver's recording, otherwise the last session the
    // driver persisted at close. Fails with an actionable message when none
    // exists instead of replaying nothing.
    const loadRecording = (source: string | undefined) =>
      Effect.gen(function* () {
        if (source !== undefined) {
          const text = yield* Effect.promise(async () => {
            const file = Bun.file(source)
            if (!(await file.exists()))
              throw new Error(`The browser action "replay" cannot read ${source}: the recording file does not exist.`)
            return file.text()
          })
          return { text, source: `the file ${source}` }
        }
        const current = yield* Ref.get(session)
        if (current !== undefined && !current.exited) {
          const live = yield* attempt("recording", () => send(current, "recording", { action: "recording" }))
          return { text: live.output, source: "the live session" }
        }
        const fallback = path.join(SCRATCH, "recording.json")
        const text = yield* Effect.promise(async () => {
          const file = Bun.file(fallback)
          if (!(await file.exists()))
            throw new Error(
              'The browser action "replay" requires a recording: no browser session is open and no ' +
                `recording exists at ${fallback}. Record a session first, or pass path=<recording.json>.`,
            )
          return file.text()
        })
        return { text, source: "the last recorded session" }
      })

    const run = (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult> =>
      Effect.gen(function* () {
        const action = params.action

        switch (action) {
          case "open": {
            yield* ask(ctx, action, params.url)
            const existing = yield* Ref.get(session)
            if (existing !== undefined && !existing.exited) {
              const result = yield* attempt("open", () => send(existing, action, params))
              return { ...result, metadata: {} }
            }
            const current = yield* startDriver
            const opened = yield* Effect.exit(
              attempt("open", () => send(current, action, params)).pipe(
                // Bounded so a wedged driver can never hang the session.
                Effect.timeoutOrElse({
                  duration: "30 seconds",
                  orElse: () =>
                    Effect.fail(
                      new Error(
                        "browser open timed out after 30s: the Node.js driver never answered " +
                          "(playwright is unresponsive in this runtime). Treat the browser as BLOCKED.",
                      ),
                    ),
                }),
              ),
            )
            if (Exit.isFailure(opened)) {
              // A session that never opened must not linger as a zombie.
              current.child.kill()
              yield* Ref.set(session, undefined)
              return yield* Effect.failCause(opened.cause)
            }
            return { ...opened.value, metadata: {} }
          }
          case "close": {
            const current = yield* Ref.get(session)
            if (current === undefined || current.exited)
              return { title: "browser close", output: "No browser session to close.", metadata: {} }
            const result = yield* attempt("close", () => send(current, action, params))
            yield* Ref.set(session, undefined)
            return { ...result, metadata: {} }
          }
          case "goto": {
            const url = requireField(action, "url", params.url)
            yield* ask(ctx, action, url)
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "back":
          case "forward": {
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "click": {
            requireField(action, "selector", params.selector)
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "fill": {
            requireField(action, "selector", params.selector)
            requireField(action, "value", params.value)
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "select": {
            requireField(action, "selector", params.selector)
            requireField(action, "value", params.value)
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "upload": {
            requireField(action, "selector", params.selector)
            requireField(action, "value", params.value)
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "screenshot": {
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "snapshot": {
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "eval": {
            requireField(action, "code", params.code)
            yield* ask(ctx, action)
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "console": {
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "network": {
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "downloads": {
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "viewport": {
            if (params.width !== undefined || params.height !== undefined) {
              const width = requireField(action, "width", params.width)
              const height = requireField(action, "height", params.height)
              if (width <= 0 || height <= 0)
                throw new Error(
                  `The browser action "viewport" requires positive width and height (got ${width}x${height}).`,
                )
              const current = yield* requireSession(action)
              const result = yield* attempt(action, () => send(current, action, params))
              return { ...result, metadata: {} }
            }
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "wait": {
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            return { ...result, metadata: {} }
          }
          case "recording": {
            const current = yield* requireSession(action)
            const result = yield* attempt(action, () => send(current, action, params))
            const decoded = BrowserRecording.decode(result.output)
            if (!Option.isSome(decoded))
              throw new Error("browser recording failed: the driver returned a payload that is not a recording.")
            const recording = decoded.value
            const slug = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
            const jsonPath = path.join(SCRATCH, `recording-${slug}.json`)
            const htmlPath = path.join(SCRATCH, `recording-${slug}.html`)
            yield* Effect.promise(() => Bun.write(jsonPath, result.output))
            yield* Effect.promise(() => Bun.write(htmlPath, BrowserRecording.render(recording)))
            const ok = recording.steps.filter((step) => step.ok).length
            const shots = recording.steps.filter((step) => step.shot !== undefined).length
            return {
              title: "Browser Test Recording",
              output: [
                `Browser Test Recording saved: ${htmlPath}`,
                `${recording.steps.length} steps (${ok} ok, ${recording.steps.length - ok} failed) · ` +
                  `${shots} screenshots · ${recording.console.length} console · ${recording.network.length} network`,
                `Replay with action "replay" path=${jsonPath}`,
              ].join("\n"),
              metadata: {},
            }
          }
          case "replay": {
            yield* ask(ctx, action)
            const loaded = yield* loadRecording(params.path)
            const decoded = BrowserRecording.decode(loaded.text)
            if (!Option.isSome(decoded))
              throw new Error(`browser replay failed: ${loaded.source} is not a Browser Test Recording.`)
            const recording = decoded.value
            if (recording.version !== 1)
              throw new Error(
                `browser replay failed: ${loaded.source} has recording version ${recording.version} (expected 1).`,
              )
            const steps = recording.steps.slice(0, MAX_REPLAY_STEPS).map((step, index) => ({ step, index }))
            replaying = true
            const attempts = yield* Effect.ensuring(
              Effect.forEach(steps, ({ step, index }) =>
                Effect.gen(function* () {
                  const label = `${index + 1}. ${step.action}`
                  if (step.action === "replay" || step.action === "recording")
                    return { line: `${label} skipped (meta action)`, state: "skipped" as const }
                  const recorded = Schema.decodeUnknownOption(Parameters)(step.params)
                  if (!Option.isSome(recorded))
                    return { line: `${label} FAILED: recorded parameters are malformed`, state: "failed" as const }
                  const exit = yield* Effect.exit(run(recorded.value, ctx))
                  if (Exit.isSuccess(exit)) return { line: `${label} ok`, state: "ok" as const }
                  const detail = Cause.squash(exit.cause)
                  return {
                    line: `${label} FAILED: ${detail instanceof Error ? detail.message : String(detail)}`,
                    state: "failed" as const,
                  }
                }),
              ),
              // Never leave the session marked as replaying, even if the
              // loop is interrupted or a permission request fails.
              Effect.sync(() => {
                replaying = false
              }),
            )
            const ok = attempts.filter((entry) => entry.state === "ok").length
            const failed = attempts.filter((entry) => entry.state === "failed").length
            const skipped = attempts.filter((entry) => entry.state === "skipped").length
            const lines = attempts.map((entry) => entry.line).slice(0, MAX_REPLAY_LINES)
            if (attempts.length > MAX_REPLAY_LINES)
              lines.push(`… and ${attempts.length - MAX_REPLAY_LINES} more steps (output capped).`)
            if (recording.steps.length > MAX_REPLAY_STEPS)
              lines.push(
                `Replay capped: ${recording.steps.length - MAX_REPLAY_STEPS} further steps were not replayed ` +
                  `(limit ${MAX_REPLAY_STEPS}).`,
              )
            return {
              title: "browser replay",
              output: [
                `Replayed ${attempts.length} of ${recording.steps.length} steps from ${loaded.source} ` +
                  `(${ok} ok, ${failed} failed${skipped > 0 ? `, ${skipped} skipped` : ""}).`,
                ...lines,
              ].join("\n"),
              metadata: {},
            }
          }
          default:
            // `satisfies never` makes a new Parameters literal without a case
            // above a compile-time error instead of a silent fallthrough.
            return yield* Effect.die(new Error(`Unsupported browser action: ${String(action satisfies never)}`))
        }
      }).pipe(Effect.orDie)

    return { description: DESCRIPTION, parameters: Parameters, execute: run }
  }),
)
