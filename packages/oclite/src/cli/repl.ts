// Interactive REPL (SPEC §1, ARCHITECTURE §5 ask routing): readline over stdin (TTY or scripted), streaming output
// through the text sink, slash commands, `@path` attachments and a REPL Asker that reads `[y]es / [a]lways / [n]o`
// from the same line queue. Ctrl-C cancels the running turn; a second Ctrl-C in a row exits 130.
import path from "path"
import readline from "readline"
import { Effect, Layer, Logger } from "effect"
import {
  Asker,
  type AskReply,
  type ProfileName,
  type RenderEvent,
  type ResolvedConfig,
  type RunHandle,
  Runtime,
  SessionStore,
  type SessionStoreShape,
} from "../contract"
import { bytes, clean, exitCode, resultEvent, stepLine } from "../render/event"
import { textSink } from "../render/text"
import type { CliArgs } from "./args"
import { BYPASS } from "./run"

const HELP = `/help                 this list
/agents [name]        list agents, or switch the primary agent
/model [provider/m]   show or set the model
/profile [name]       show or set the profile (default | local | local-min)
/compact              compact the conversation
/clear                start a new session
/cost                 token usage of this session
/resume [id]          list recent sessions, or resume one
/reconnect, /mcp      MCP servers (phase 4)
/exit                 quit
@path                 attach a file to the prompt`
const PROFILES: readonly string[] = ["default", "local", "local-min"]
const MAX_ATTACH = 256 * 1024

export function runRepl(args: CliArgs) {
  return Effect.gen(function* () {
    const tty = process.stdin.isTTY === true
    const sink = textSink({ showThinking: !args.noThinking, tty: process.stderr.isTTY === true })
    yield* sink({ session_id: "", agent_path: [], type: "status", phase: "config", message: "loading config" })
    const { load } = yield* Effect.promise(() => import("../config/config"))
    const cfg = yield* load(args)
    if (cfg.permissionMode === "bypassPermissions") yield* sink({ session_id: "", agent_path: [], type: "status", phase: "notice", message: BYPASS })
    const { appLayer } = yield* Effect.promise(() => import("../runtime/runtime"))
    const rl = readline.createInterface({ input: process.stdin, output: tty ? process.stdout : undefined, terminal: tty, prompt: "› " })
    const lines = rl[Symbol.asyncIterator]()
    const next = () => lines.next().then((item) => (item.done ? undefined : String(item.value)))
    const current = { run: undefined as RunHandle | undefined, interrupts: 0 }
    // runMain would interrupt the whole REPL on the first Ctrl-C; the REPL owns SIGINT instead.
    const interrupt = () => {
      current.interrupts++
      if (current.interrupts >= 2) process.exit(130)
      if (current.run) return void Effect.runFork(current.run.cancel)
      process.stderr.write("\n(press Ctrl-C again to exit)\n")
      if (tty) rl.prompt()
    }
    process.removeAllListeners("SIGINT")
    process.on("SIGINT", interrupt)
    rl.on("SIGINT", interrupt)
    const asker = Layer.succeed(Asker, {
      ask: (req) =>
        Effect.gen(function* () {
          yield* sink({ session_id: req.session_id, agent_path: [], type: "status", phase: "permission", message: `permission: ${req.summary}` })
          process.stderr.write("allow? [y]es / [a]lways / [n]o › ")
          return answer(yield* Effect.promise(next))
        }),
    })
    yield* loop(cfg, args, { next, prompt: () => tty && rl.prompt(), current, sink }).pipe(Effect.provide(appLayer(cfg, asker)))
    rl.close()
    process.stdin.destroy()
  }).pipe(Effect.provideService(Logger.LogToStderr, true))
}

type Io = { next: () => Promise<string | undefined>; prompt: () => unknown; current: { run?: RunHandle; interrupts: number }; sink: (event: RenderEvent) => Effect.Effect<void> }

function loop(cfg: ResolvedConfig, args: CliArgs, io: Io) {
  return Effect.gen(function* () {
    const runtime = yield* Runtime
    const store = yield* SessionStore
    const session = {
      id: args.resume ?? (args.continue ? yield* store.latest(cfg.cwd) : undefined),
      agent: cfg.default_agent,
      model: args.model,
      profile: cfg.profile,
    }
    const say = (text: string) => Effect.sync(() => console.log(clean(text)))

    const agentModel = () => cfg.agents[session.agent]?.model
    const later = () => say("MCP arrives in phase 4")
    const commands: Record<string, (arg: string) => Effect.Effect<unknown>> = {
      help: () => say(HELP),
      agents: (arg) =>
        Effect.suspend(() => {
          if (cfg.agents[arg]) session.agent = arg
          return say(Object.values(cfg.agents).sort((a, b) => a.name.localeCompare(b.name))
            .map((agent) => `${agent.name === session.agent ? "*" : " "} ${agent.name.padEnd(10)} ${agent.mode.padEnd(8)} ${agent.description ?? ""}`).join("\n"))
        }),
      model: (arg) =>
        Effect.suspend(() => {
          if (arg) session.model = arg
          return say(`model: ${agentModel() ?? session.model ?? cfg.model}${agentModel() ? ` (set by agent ${session.agent})` : ""}`)
        }),
      profile: (arg) =>
        Effect.suspend(() => {
          if (PROFILES.includes(arg)) session.profile = arg as ProfileName
          return say(`profile: ${session.profile ?? "auto"}${arg && !PROFILES.includes(arg) ? ` (unknown "${arg}")` : ""}`)
        }),
      clear: () => Effect.sync(() => void (session.id = undefined)).pipe(Effect.andThen(say("new session"))),
      cost: () => cost(store, session.id).pipe(Effect.flatMap(say)),
      resume: (arg) =>
        arg ? Effect.sync(() => void (session.id = arg)).pipe(Effect.andThen(say(`resuming ${arg}`))) : recent(store, cfg.cwd).pipe(Effect.flatMap(say)),
      // Deviation: RuntimeShape has no compaction entry point yet; compaction still runs at the profile threshold.
      compact: () => say("compaction runs automatically at the profile threshold (manual /compact needs a Runtime seam)"),
      mcp: later,
      reconnect: later,
    }
    const slash = (name: string, arg: string) =>
      commands[name]?.(arg) ?? (name.startsWith("mcp__") ? later() : say(`unknown command /${name} (try /help)`))

    while (true) {
      io.prompt()
      const line = yield* Effect.promise(io.next)
      if (line === undefined) return
      const text = line.trim()
      if (!text) continue
      io.current.interrupts = 0
      if (text.startsWith("/")) {
        const [name = "", ...rest] = text.slice(1).split(/\s+/)
        if (name === "exit" || name === "quit") return
        yield* slash(name, rest.join(" "))
        continue
      }
      const prompt = yield* Effect.promise(() => attach(text, cfg.cwd))
      const started = yield* runtime
        .start({ session_id: session.id, agent: session.agent, prompt, model: session.model, profile: session.profile }, io.sink)
        .pipe(Effect.catch((error) => say(`error: ${error.message}`).pipe(Effect.as(undefined))))
      if (!started) continue
      session.id = started.session_id
      io.current.run = started
      const result = yield* started.await
      io.current.run = undefined
      yield* io.sink(resultEvent(result, exitCode(result, false)))
      if (result.state === "cancelled") yield* say("(cancelled)")
    }
  })
}

function answer(line: string | undefined): AskReply {
  const value = line?.trim().toLowerCase() ?? ""
  if (value === "y" || value === "yes") return "once"
  if (value === "a" || value === "always") return "always"
  return "reject"
}

/** `@path` tokens that name a readable file are appended as <file> blocks; `@server:uri` resources are phase 4. */
async function attach(text: string, cwd: string) {
  const refs = [...text.matchAll(/(?:^|\s)@([^\s:]+)(?=\s|$)/g)].map((match) => match[1]!)
  const files = await Promise.all(
    [...new Set(refs)].map(async (ref) => {
      const file = Bun.file(path.resolve(cwd, ref))
      if (!(await file.exists())) return undefined
      const body = file.size > MAX_ATTACH ? `${await file.slice(0, MAX_ATTACH).text()}\n…[truncated at ${bytes(MAX_ATTACH)}]` : await file.text()
      return `<file path="${ref}">\n${body}\n</file>`
    }),
  )
  return [text, ...files.filter((item) => item !== undefined)].join("\n\n")
}

function cost(store: SessionStoreShape, id: string | undefined) {
  return Effect.gen(function* () {
    if (!id) return "no session yet"
    const steps = (yield* store.read(id)).flatMap((record) => (record.type === "step" ? [record.usage] : []))
    const total = steps.reduce(
      (sum, usage) => ({ input: sum.input + usage.input, output: sum.output + usage.output, estimated: sum.estimated || usage.estimated }),
      { input: 0, output: 0, estimated: false },
    )
    return `cost: ${id} · ${stepLine(steps.length, total).replace(/^step/, "steps")}`
  })
}

function recent(store: SessionStoreShape, cwd: string) {
  return store.list({ cwd, limit: 10 }).pipe(
    Effect.map((items) =>
      items.length
        ? items.map((item) => `${item.id}  ${new Date(item.created_at).toISOString().slice(0, 16).replace("T", " ")}  ${item.agent}  ${item.model}`).join("\n")
        : "no sessions in this directory",
    ),
  )
}
