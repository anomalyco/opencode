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
//
// The engine itself now lives server-side in @/loop/loop (see design notes
// there) so loops survive this CLI process exiting and are visible from the
// TUI's /loops dialog. This file is a thin client: it starts a loop and
// polls the server for status until the loop reaches a terminal state.
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { createOpencodeClient, LoopArgDefaults, type Loop } from "@opencode-ai/sdk/v2"

const POLL_INTERVAL_MS = 1000

function statusColor(status: Loop["status"]) {
  switch (status) {
    case "completed":
      return UI.Style.TEXT_SUCCESS_BOLD
    case "stalled":
    case "error":
      return UI.Style.TEXT_DANGER_BOLD
    case "cancelled":
      return UI.Style.TEXT_DIM
    default:
      return UI.Style.TEXT_NORMAL
  }
}

const TERMINAL_STATUSES = new Set<Loop["status"]>(["completed", "stalled", "cancelled", "max_reached", "error"])

async function follow(sdk: ReturnType<typeof createOpencodeClient>, id: string) {
  let iteration = 0
  while (true) {
    const result = await sdk.loop.get({ loopID: id })
    const info = result.data
    if (!info) {
      UI.println(`loop ${id} not found`)
      return
    }
    if (info.iteration !== iteration) {
      iteration = info.iteration
      const last = info.iterations.at(-1)
      UI.println(
        `${UI.Style.TEXT_DIM}[${id}] iteration ${iteration}/${info.maxIterations} — ${last?.toolCalls ?? 0} tool call(s)${UI.Style.TEXT_NORMAL}`,
      )
    }
    if (TERMINAL_STATUSES.has(info.status)) {
      UI.println(`${statusColor(info.status)}[${id}] ${info.status}${UI.Style.TEXT_NORMAL}`)
      return
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
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
        describe: `max iterations (default: ${LoopArgDefaults.maxIterations})`,
        default: LoopArgDefaults.maxIterations,
      })
      .option("interval", {
        type: "number",
        alias: "i",
        describe: "seconds between iterations (omit for back-to-back ralph style)",
      })
      .option("no-progress-limit", {
        type: "number",
        describe: `consecutive no-progress iterations before stopping (default: ${LoopArgDefaults.noProgressLimit}, 0 disables)`,
        default: LoopArgDefaults.noProgressLimit,
      })
      .option("server", {
        type: "string",
        describe: "opencode server URL (default: http://localhost:2525)",
        default: "http://localhost:2525",
      }),
  handler: Effect.fn("Cli.loop")(function* (args) {
    const prompt = args.prompt
    if (!prompt) yield* fail("prompt is required")

    const sdk = createOpencodeClient({ baseUrl: args.server })
    const created = yield* Effect.promise(() =>
      sdk.loop.create({
        prompt,
        maxIterations: args.max,
        interval: args.interval,
        noProgressLimit: args["no-progress-limit"],
      }),
    )
    if (created.error || !created.data) yield* fail("failed to create loop")
    const info = created.data!

    UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}loop ${info.id}${UI.Style.TEXT_NORMAL} started (max ${info.maxIterations} iterations)`)

    yield* Effect.promise(() => follow(sdk, info.id))
  }),
})

// ── loop list ────────────────────────────────────────────────────────────────

export const LoopListCommand = effectCmd({
  command: "loop list",
  describe: "list loops known to the server",
  instance: false,
  builder: (yargs) =>
    yargs.option("server", {
      type: "string",
      describe: "opencode server URL (default: http://localhost:2525)",
      default: "http://localhost:2525",
    }),
  handler: Effect.fn("Cli.loopList")(function* (args) {
    const sdk = createOpencodeClient({ baseUrl: args.server })
    const result = yield* Effect.promise(() => sdk.loop.list())
    const loops = result.data ?? []
    if (loops.length === 0) {
      UI.println("no active loops")
      return
    }
    for (const info of loops) {
      UI.println(
        `${UI.Style.TEXT_SUCCESS_BOLD}${info.id}${UI.Style.TEXT_NORMAL}  ${info.status}  iter ${info.iteration}/${info.maxIterations}  "${info.prompt.slice(0, 60)}"`,
      )
    }
  }),
})

// ── loop cancel / pause / resume ────────────────────────────────────────────

const serverOption = (yargs: import("yargs").Argv) =>
  yargs
    .positional("id", { type: "string" as const, describe: "loop ID", demandOption: true })
    .option("server", {
      type: "string" as const,
      describe: "opencode server URL (default: http://localhost:2525)",
      default: "http://localhost:2525",
    })

export const LoopCancelCommand = effectCmd({
  command: "loop cancel <id>",
  describe: "cancel a running loop",
  instance: false,
  builder: serverOption,
  handler: Effect.fn("Cli.loopCancel")(function* (args) {
    const sdk = createOpencodeClient({ baseUrl: args.server })
    const result = yield* Effect.promise(() => sdk.loop.cancel({ loopID: args.id! }))
    if (result.error || !result.data) yield* fail(`loop ${args.id} not found`)
    UI.println(`loop ${args.id} cancelled`)
  }),
})

export const LoopPauseCommand = effectCmd({
  command: "loop pause <id>",
  describe: "pause a running loop",
  instance: false,
  builder: serverOption,
  handler: Effect.fn("Cli.loopPause")(function* (args) {
    const sdk = createOpencodeClient({ baseUrl: args.server })
    const result = yield* Effect.promise(() => sdk.loop.pause({ loopID: args.id! }))
    if (result.error || !result.data) yield* fail(`loop ${args.id} not found`)
    UI.println(`loop ${args.id} paused`)
  }),
})

export const LoopResumeCommand = effectCmd({
  command: "loop resume <id>",
  describe: "resume a paused loop",
  instance: false,
  builder: serverOption,
  handler: Effect.fn("Cli.loopResume")(function* (args) {
    const sdk = createOpencodeClient({ baseUrl: args.server })
    const result = yield* Effect.promise(() => sdk.loop.resume({ loopID: args.id! }))
    if (result.error || !result.data) yield* fail(`loop ${args.id} not found`)
    UI.println(`loop ${args.id} resumed`)
  }),
})
