// `oclite -p "<prompt>"` one-shot (SPEC §1, §9; ARCHITECTURE §4, §11). The first status line is written before
// config is read; config, runtime and permission modules load lazily after it. The loop never emits `result`:
// this file does, because it decides the exit code. Text mode keeps stdout for assistant text only.
import { Effect, Logger } from "effect"
import {
  ConfigError,
  type EventSink,
  LlmGateway,
  Mcp,
  type RenderEvent,
  type ResolvedConfig,
  type RunResult,
  Runtime,
  SessionStore,
} from "../contract"
import { clean, exitCode, exitReason, resultEvent } from "../render/event"
import { jsonCollector, streamJsonSink } from "../render/json"
import { textSink } from "../render/text"
import { statusText } from "../mcp/tools"
import { killAll } from "../tools/bash"
import type { CliArgs } from "./args"

export const BYPASS = "permission mode bypassPermissions: all tools allowed except .env access and your explicit deny rules"

export function runPrint(args: CliArgs) {
  const output = renderer(args)
  return Effect.gen(function* () {
    yield* output.sink(early({ type: "status", phase: "config", message: "loading config" }))
    const { load, trustNotice } = yield* Effect.promise(() => import("../config/config"))
    const cfg = yield* load(args)
    const untrusted = trustNotice(cfg)
    if (untrusted) yield* output.sink(early({ type: "status", phase: "notice", message: untrusted }))
    if (cfg.permissionMode === "bypassPermissions") yield* output.sink(early({ type: "status", phase: "notice", message: BYPASS }))
    const { appLayer } = yield* Effect.promise(() => import("../runtime/runtime"))
    const { headlessAsker } = yield* Effect.promise(() => import("../permission/permission"))
    process.exitCode = yield* execute(cfg, args, output).pipe(Effect.provide(appLayer(cfg, headlessAsker)))
  }).pipe(
    Effect.tapError((error) => failed(args, output, error)),
    // Effect logs (e.g. core Ripgrep's "downloading ripgrep" on first use) would otherwise land on stdout.
    Effect.provideService(Logger.LogToStderr, true),
  )
}

type Output = ReturnType<typeof renderer>

function renderer(args: CliArgs) {
  const collector = args.outputFormat === "json" ? jsonCollector() : undefined
  const sink: EventSink =
    collector?.sink ??
    (args.outputFormat === "stream-json"
      ? streamJsonSink()
      : textSink({ showThinking: !args.noThinking, tty: process.stderr.isTTY === true }))
  // json prints one object at the end; the other formats already streamed everything.
  const flush = () => collector && process.stdout.write(JSON.stringify(collector.result()) + "\n")
  return { sink, flush }
}

function execute(cfg: ResolvedConfig, args: CliArgs, output: Output) {
  return Effect.gen(function* () {
    const runtime = yield* Runtime
    const gateway = yield* LlmGateway
    const store = yield* SessionStore
    const mcp = yield* Mcp
    const { fallbackNotices } = yield* Effect.promise(() => import("../llm/client"))
    const session_id = args.resume ?? (args.continue ? yield* latest(store.latest(cfg.cwd), cfg.cwd) : undefined)
    const agent = cfg.agents[cfg.default_agent]!
    const ref = agent.model ?? cfg.model
    yield* output.sink(early({ type: "status", phase: "probe", message: `resolving ${ref}` }))
    // Resolving here (the gateway caches the handle for start) lets the one-time fallback notices print first.
    // MCP servers connect while the model server is resolved (probe); both report their own status lines.
    const connecting = mcp.connectAll((status) => output.sink(early({ type: "status", phase: "mcp", message: `mcp ${statusText(status)}` })))
    const [handle] = yield* Effect.all([gateway.resolve(ref), connecting], { concurrency: 2 })
    yield* Effect.forEach(
      fallbackNotices(handle),
      (item) =>
        gateway
          .notice(item.key, item.message)
          .pipe(Effect.flatMap((first) => (first ? output.sink(early({ type: "status", phase: "notice", message: item.message })) : Effect.void))),
      { discard: true },
    )
    const run = yield* runtime.start(
      { session_id, agent: agent.name, prompt: args.print ?? "", maxTurns: cfg.maxTurns },
      output.sink,
    )
    const signal = { name: undefined as NodeJS.Signals | undefined }
    const finish = (result: RunResult) =>
      Effect.gen(function* () {
        const code = signal.name && result.state === "cancelled" ? SIGNAL_CODES[signal.name] : exitCode(result, true)
        yield* output.sink(resultEvent(result, code))
        output.flush()
        const reason = args.outputFormat === "text" ? exitReason(result, code) : undefined
        if (reason) process.stderr.write(`oclite: ${clean(reason)}\n`)
        return code
      })
    // From here SIGINT/SIGTERM/SIGHUP cancel the detached loop: the session records `end: cancelled`, the result
    // event is still emitted, exit 130/143/129. (Before this, runMain's handler interrupts and exits 130.) A second
    // signal waits up to 2 s for that cancel (its finalizers kill tool process groups), then exits.
    const cancelling = { done: undefined as Promise<void> | undefined }
    const onSignal = (name: NodeJS.Signals) => {
      signal.name ??= name
      if (cancelling.done) {
        void Promise.race([cancelling.done, Bun.sleep(2000)]).then(() => {
          killAll()
          process.exit(SIGNAL_CODES[name])
        })
        return
      }
      cancelling.done = Effect.runPromise(run.cancel)
    }
    Object.keys(SIGNAL_CODES).forEach((name) => {
      process.removeAllListeners(name)
      process.on(name, onSignal)
    })
    return yield* run.await.pipe(Effect.flatMap(finish))
  })
}

const SIGNAL_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }

/** REPL and mcp serve: SIGTERM/SIGHUP kill every bash/hook process group first. `exit` false leaves the exit to runMain. */
export function killOnTerm(options: { before?: () => unknown; exit: (name: string) => boolean }) {
  ;["SIGTERM", "SIGHUP"].forEach((name) =>
    process.on(name, () => {
      options.before?.()
      killAll()
      if (options.exit(name)) process.exit(SIGNAL_CODES[name])
    }),
  )
}

function latest(found: Effect.Effect<string | undefined>, cwd: string) {
  return found.pipe(
    Effect.flatMap((id) =>
      id ? Effect.succeed(id) : Effect.fail(new ConfigError({ message: `--continue: no previous session in ${cwd}` })),
    ),
  )
}

/** Config/usage errors still end with a `result` (exit 2) in json/stream-json; index.ts prints the message. */
function failed(args: CliArgs, output: Output, error: ConfigError) {
  return Effect.gen(function* () {
    if (args.outputFormat !== "text") yield* output.sink(early({ type: "error", message: error.message, retryable: false }))
    yield* output.sink(
      early({ type: "result", state: "failed", text: "", turns: 0, usage: { input: 0, output: 0, estimated: true }, exit_code: 2 }),
    )
    output.flush()
  })
}

/** Events emitted before a session exists carry an empty session_id. */
function early(event: DistributiveOmit<RenderEvent, "session_id" | "agent_path">): RenderEvent {
  return { session_id: "", agent_path: [], ...event } as RenderEvent
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
