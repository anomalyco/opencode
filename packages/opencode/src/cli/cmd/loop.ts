// Loop command — hybrid of ralph (iterate until COMPLETE signal) and
// Claude Code loop (repeat a prompt on a fixed interval).
//
// Usage:
//   opencode loop "<prompt>"                 # ralph style: iterate until COMPLETE or --max
//   opencode loop "<prompt>" --interval 60   # timed style: re-send every N seconds
//   opencode loop list
//   opencode loop cancel <id>
//   opencode loop pause  <id>
//   opencode loop resume <id>

import { Effect, Duration } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

const COMPLETE_SIGNAL = "<promise>COMPLETE</promise>"

// In-process registry of active loops (survives only for this process lifetime).
interface LoopState {
  id: string
  prompt: string
  iteration: number
  maxIterations: number
  interval: number | null
  paused: boolean
  cancelled: boolean
  startedAt: Date
  lastRunAt: Date | null
}

const loops = new Map<string, LoopState>()

function newID() {
  return `loop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

async function runIteration(sdk: ReturnType<typeof createOpencodeClient>, prompt: string): Promise<{ output: string; complete: boolean }> {
  const session = await sdk.session.create({ title: "loop" })
  if (session.error || !session.data) return { output: "", complete: false }

  const sessionID = session.data.id
  const events = await sdk.event.subscribe()

  await sdk.session.prompt({ sessionID, parts: [{ type: "text", text: prompt }] } as any)

  let output = ""
  for await (const event of events.stream as AsyncGenerator<any, unknown, unknown>) {
    if (event.type === "message.part.updated") {
      const part = event.properties?.part
      if (part?.sessionID !== sessionID) continue
      if (part?.type === "text" && part.time?.end) output += part.text
    }
    if (
      event.type === "session.status" &&
      event.properties?.sessionID === sessionID &&
      event.properties?.status?.type === "idle"
    ) break
  }

  return { output, complete: output.includes(COMPLETE_SIGNAL) }
}

async function runLoop(sdk: ReturnType<typeof createOpencodeClient>, state: LoopState): Promise<void> {
  for (let i = 1; i <= state.maxIterations; i++) {
    if (state.cancelled) {
      UI.println(`loop ${state.id} cancelled at iteration ${i}`)
      break
    }
    while (state.paused) {
      await new Promise((r) => setTimeout(r, 500))
      if (state.cancelled) break
    }
    if (state.cancelled) break

    state.iteration = i
    state.lastRunAt = new Date()
    UI.println(`${UI.Style.TEXT_DIM}[${state.id}] iteration ${i}/${state.maxIterations}${UI.Style.TEXT_NORMAL}`)

    const { output, complete } = await runIteration(sdk, state.prompt)

    if (output.trim()) {
      UI.println(output.trim())
      UI.empty()
    }

    if (complete) {
      UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}[${state.id}] complete signal received — stopping${UI.Style.TEXT_NORMAL}`)
      break
    }

    if (i < state.maxIterations) {
      const delaySec = state.interval ?? 2
      await new Promise((r) => setTimeout(r, delaySec * 1000))
    }
  }
}

// ── loop (root run command) ──────────────────────────────────────────────────

export const LoopCommand = effectCmd({
  command: "loop <prompt>",
  describe: "run a prompt in a loop until complete or max iterations reached",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("prompt", { type: "string", describe: "prompt to repeat", demandOption: true })
      .option("max", {
        type: "number",
        alias: "n",
        describe: "max iterations (default: 10)",
        default: 10,
      })
      .option("interval", {
        type: "number",
        alias: "i",
        describe: "seconds between iterations (omit for back-to-back ralph style)",
      })
      .option("server", {
        type: "string",
        describe: "opencode server URL (default: http://localhost:2525)",
        default: "http://localhost:2525",
      }),
  handler: Effect.fn("Cli.loop")(function* (args) {
    const prompt = args.prompt
    if (!prompt) yield* fail("prompt is required")

    const id = newID()
    const state: LoopState = {
      id,
      prompt,
      iteration: 0,
      maxIterations: args.max,
      interval: args.interval ?? null,
      paused: false,
      cancelled: false,
      startedAt: new Date(),
      lastRunAt: null,
    }
    loops.set(id, state)

    UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}loop ${id}${UI.Style.TEXT_NORMAL} started (max ${state.maxIterations} iterations)`)

    const sdk = createOpencodeClient({ baseUrl: args.server })

    yield* Effect.promise(() => runLoop(sdk, state))

    loops.delete(id)
    UI.println(`${UI.Style.TEXT_DIM}loop ${id} finished${UI.Style.TEXT_NORMAL}`)
  }),
})

// ── loop list ────────────────────────────────────────────────────────────────

export const LoopListCommand = effectCmd({
  command: "loop list",
  describe: "list running loops",
  instance: false,
  handler: Effect.fn("Cli.loopList")(function* () {
    if (loops.size === 0) {
      UI.println("no active loops")
      return
    }
    for (const s of loops.values()) {
      const status = s.paused ? "paused" : s.cancelled ? "cancelled" : "running"
      UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}${s.id}${UI.Style.TEXT_NORMAL}  ${status}  iter ${s.iteration}/${s.maxIterations}  "${s.prompt.slice(0, 60)}"`)
    }
  }),
})

// ── loop cancel ──────────────────────────────────────────────────────────────

export const LoopCancelCommand = effectCmd({
  command: "loop cancel <id>",
  describe: "cancel a running loop",
  instance: false,
  builder: (yargs) => yargs.positional("id", { type: "string", describe: "loop ID", demandOption: true }),
  handler: Effect.fn("Cli.loopCancel")(function* (args) {
    const state = loops.get(args.id ?? "")
    if (!state) yield* fail(`loop ${args.id} not found`)
    state!.cancelled = true
    UI.println(`loop ${args.id} cancelled`)
  }),
})

// ── loop pause ───────────────────────────────────────────────────────────────

export const LoopPauseCommand = effectCmd({
  command: "loop pause <id>",
  describe: "pause a running loop",
  instance: false,
  builder: (yargs) => yargs.positional("id", { type: "string", describe: "loop ID", demandOption: true }),
  handler: Effect.fn("Cli.loopPause")(function* (args) {
    const state = loops.get(args.id ?? "")
    if (!state) yield* fail(`loop ${args.id} not found`)
    state!.paused = true
    UI.println(`loop ${args.id} paused`)
  }),
})

// ── loop resume ──────────────────────────────────────────────────────────────

export const LoopResumeCommand = effectCmd({
  command: "loop resume <id>",
  describe: "resume a paused loop",
  instance: false,
  builder: (yargs) => yargs.positional("id", { type: "string", describe: "loop ID", demandOption: true }),
  handler: Effect.fn("Cli.loopResume")(function* (args) {
    const state = loops.get(args.id ?? "")
    if (!state) yield* fail(`loop ${args.id} not found`)
    state!.paused = false
    UI.println(`loop ${args.id} resumed`)
  }),
})
