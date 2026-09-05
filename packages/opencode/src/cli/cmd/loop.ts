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
      const where = info.currentChange ? ` — ${info.currentChange} [${info.currentGate ?? "?"}]` : ""
      UI.println(
        `${UI.Style.TEXT_DIM}[${id}] iteration ${iteration}/${info.maxIterations}${where} — ${last?.toolCalls ?? 0} tool call(s)${UI.Style.TEXT_NORMAL}`,
      )
    }
    if (TERMINAL_STATUSES.has(info.status)) {
      UI.println(`${statusColor(info.status)}[${id}] ${info.status}${UI.Style.TEXT_NORMAL}`)
      if (info.report) UI.println(info.report)
      return
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

// ── loop (root run command) ──────────────────────────────────────────────────

export const LoopCommand = effectCmd({
  command: "loop [prompt]",
  describe: `run a prompt in a loop until the agent emits ${LoopArgDefaults.completionToken} (disclosed to it each iteration) or max iterations is reached`,
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("prompt", { type: "string", describe: "prompt to repeat (omit with --queue)" })
      .option("queue", {
        type: "string",
        array: true,
        describe:
          "queue mode: work openspec changes to completion (implement, test, verify, commit, push). " +
          "Pass change slugs to restrict/order the queue; bare --queue takes every eligible change. " +
          "Stuck changes are quarantined via .skein/blocker.md and the run continues.",
      })
      .option("max", {
        type: "number",
        alias: "n",
        describe: `max iterations (default: ${LoopArgDefaults.maxIterations})`,
        default: LoopArgDefaults.maxIterations,
      })
      .option("interval", {
        type: "number",
        alias: "i",
        describe: `seconds between iterations (default: ${LoopArgDefaults.intervalSeconds})`,
      })
      .option("gate-cwd", {
        type: "string",
        describe:
          "queue mode: directory the gate commands run in (default: the repo root). " +
          "Set this when the test runner must be invoked from a package directory",
      })
      .option("test-command", {
        type: "string",
        describe: "queue mode: command for the test gate (default: bun test)",
      })
      .option("verify-command", {
        type: "string",
        describe: "queue mode: command for the verify gate (default: bun run typecheck)",
      })
      .option("sync", {
        type: "boolean",
        default: false,
        describe: "queue mode: run specsync for each completed change (a dry run is executed first). Off by default",
      })
      .option("push", {
        type: "boolean",
        default: true,
        describe:
          "queue mode: push each completed change's branch to origin (default: on). --no-push leaves the commits local. " +
          "The default branch is never pushed, and the model still cannot run a push itself — the driver does it.",
      })
      .option("eternal", {
        type: "boolean",
        default: true,
        describe:
          "prompt mode: on completion, continue automatically into openspec backlog work if any exists " +
          "(default: on). --no-eternal stops on completion exactly as before this flag existed. " +
          "Ignored in --queue mode, which is already relentless by construction.",
      })
      .option("guidance", {
        type: "string",
        describe:
          "queue mode: a standing instruction repeated on every iteration. Steers HOW the work is done; never what is worked",
      })
      .option("completion-token", {
        type: "string",
        describe: `stop word the agent must emit to end the loop (default: ${LoopArgDefaults.completionToken})`,
      })
      // Primary name is `stall-limit` because yargs' boolean-negation eats the
      // other one: `--no-progress-limit 0` parses as `progress-limit=false`
      // plus a stray positional `0`, and yargs answers by printing help. Only
      // the `=` form ever worked. The old spelling stays as an alias so
      // anything already using `--no-progress-limit=0` keeps working.
      .option("stall-limit", {
        type: "number",
        alias: "no-progress-limit",
        describe: `consecutive no-progress iterations before stopping (default: ${LoopArgDefaults.noProgressLimit}, 0 disables)`,
        default: LoopArgDefaults.noProgressLimit,
      })
      .option("server", {
        type: "string",
        describe: "opencode server URL (default: http://localhost:2525)",
        default: "http://localhost:2525",
      })
      // Subcommands must be registered under the parent, not as separate
      // top-level `loop <verb>` commands: yargs matches commands by their
      // first token, so five commands all starting with "loop" collide and
      // the last-registered one wins — which is why `opencode loop "<prompt>"`
      // and `opencode loop list` both used to print the help for
      // `loop resume <id>`.
      .command(LoopListCommand)
      .command(LoopCancelCommand)
      .command(LoopPauseCommand)
      .command(LoopResumeCommand),
  handler: Effect.fn("Cli.loop")(function* (args) {
    const queueMode = args.queue !== undefined
    const prompt = args.prompt
    if (!prompt && !queueMode) yield* fail("prompt is required (or pass --queue)")

    const sdk = createOpencodeClient({ baseUrl: args.server })
    const created = yield* Effect.promise(() =>
      sdk.loop.create({
        prompt: prompt ?? "",
        maxIterations: args.max,
        interval: args.interval,
        noProgressLimit: args["stall-limit"],
        completionToken: args["completion-token"],
        mode: queueMode ? "queue" : undefined,
        eternal: !queueMode && args.eternal === false ? false : undefined,
        queue: queueMode && args.queue && args.queue.length > 0 ? args.queue : undefined,
        queueSync: queueMode && args.sync ? true : undefined,
        queuePush: queueMode && args.push === false ? false : undefined,
        queueGuidance: queueMode ? args.guidance : undefined,
        queueOptions:
          queueMode && (args["gate-cwd"] || args["test-command"] || args["verify-command"])
            ? {
                cwd: args["gate-cwd"],
                testCommand: args["test-command"],
                verifyCommand: args["verify-command"],
              }
            : undefined,
      }),
    )
    // Say WHY. "failed to create loop" on its own sent me hunting for a
    // misconfigured queue when the server simply was not running on --server,
    // and it would do the same to anyone whose run refuses to start.
    const createError: unknown = created.error
    if (createError || !created.data) {
      const detail =
        createError === undefined || createError === null
          ? "the server returned no loop"
          : typeof createError === "string"
            ? createError
            : JSON.stringify(createError)
      yield* fail(`failed to create loop: ${detail} (server: ${args.server})`)
    }
    const info = created.data!

    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}loop ${info.id}${UI.Style.TEXT_NORMAL} started (max ${info.maxIterations} iterations)`,
    )

    yield* Effect.promise(() => follow(sdk, info.id))
  }),
})

// ── loop list ────────────────────────────────────────────────────────────────

export const LoopListCommand = effectCmd({
  command: "list",
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
  yargs.positional("id", { type: "string" as const, describe: "loop ID", demandOption: true }).option("server", {
    type: "string" as const,
    describe: "opencode server URL (default: http://localhost:2525)",
    default: "http://localhost:2525",
  })

export const LoopCancelCommand = effectCmd({
  command: "cancel <id>",
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
  command: "pause <id>",
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
  command: "resume <id>",
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
