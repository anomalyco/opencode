import { Effect, Option } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { Prompt } from "@/cli/effect/prompt"
import { Insights, type ProgressEvent, type RunResult } from "@/insights/insights"
import { resolveLanguageModel, resolveModelMetadata } from "@/insights/model"
import { loadCachedFacet } from "@/insights/facets"
import { Provider } from "@/provider/provider"
import type { SessionMeta } from "@/insights/schema"

const ORANGE = "\x1b[38;5;214m"
const MUTED = "\x1b[0;2m"
const RESET = "\x1b[0m"
const BAR_WIDTH = 36

interface ProgressReporter {
  report: (e: ProgressEvent) => void
  finish: () => void
}

/**
 * Inline progress bar for stderr. Mirrors the SQLite-migration bar in
 * `src/index.ts` (TTY → percent + bar + label, non-TTY → plain lines).
 *
 * Also disables stdin echo for the duration of the bar so stray arrow-key
 * presses don't leak escape sequences (`^[[C^[[D`) into the bar line.
 *
 * TTY side-effects (cursor hide, stdin raw-mode + pause) are deferred until
 * the first `report()` call so the reporter can be constructed before an
 * interactive confirm prompt without breaking it. Constructing the reporter
 * up-front would otherwise pause stdin and mute the cursor while clack's
 * `confirm()` is waiting for keypresses.
 */
function makeProgressReporter(): ProgressReporter {
  const tty = process.stderr.isTTY
  const state = { last: -1, initialized: false, restoreStdin: false, finished: false }

  const initOnce = () => {
    if (state.initialized || !tty) return
    state.initialized = true
    process.stderr.write("\x1b[?25l") // hide cursor
    // Disable terminal echo on stdin so accidental keypresses (arrow keys,
    // enter, etc.) don't print escape codes over the bar. We intentionally
    // pair setRawMode with pause() so stdin bytes are consumed silently
    // rather than queued for the parent shell.
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true)
      process.stdin.pause()
      state.restoreStdin = true
    }
  }

  const report = (e: ProgressEvent) => {
    initOnce()
    const percent = e.total > 0 ? Math.floor((e.current / e.total) * 100) : 0
    const final = e.total > 0 && e.current === e.total
    if (percent === state.last && !final) return
    state.last = percent
    if (tty) {
      const fill = Math.round((percent / 100) * BAR_WIDTH)
      const bar = `${"\u25A0".repeat(fill)}${"\u30FB".repeat(BAR_WIDTH - fill)}`
      // Erase the rest of the line (\x1b[K) before redraw — defends against
      // any stray bytes from stdin that managed to land before we paused it.
      process.stderr.write(
        `\r\x1b[K${ORANGE}${bar} ${percent.toString().padStart(3)}%${RESET} ${MUTED}${e.label.padEnd(10)} ${e.current}/${e.total}${RESET}`,
      )
      if (final) process.stderr.write("\n")
      return
    }
    process.stderr.write(`insights-progress: ${percent}% ${e.label} ${e.current}/${e.total}\n`)
  }

  const finish = () => {
    if (state.finished) return // idempotent — safe to call from both Effect cleanup and signal handlers
    state.finished = true
    if (tty && state.initialized) process.stderr.write("\x1b[?25h") // show cursor
    if (state.restoreStdin && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false)
      process.stdin.resume()
    }
  }

  // SIGINT/SIGTERM bypass Effect's `acquireUseRelease` finalizer because Bun
  // kills the process synchronously before the Effect runtime can observe
  // the signal. Without these handlers, Ctrl-C mid-run leaves the user with
  // a hidden cursor + paused/raw stdin — they have to type `reset` blind.
  // `process.once("exit")` covers normal-exit and uncaught-exception paths.
  process.once("exit", finish)
  const onSignal = (signal: NodeJS.Signals) => {
    finish()
    // Re-raise so the parent shell's exit code is correct (130 = SIGINT).
    process.removeAllListeners(signal)
    process.kill(process.pid, signal)
  }
  process.once("SIGINT", () => onSignal("SIGINT"))
  process.once("SIGTERM", () => onSignal("SIGTERM"))

  return { report, finish }
}

/**
 * Bounded `Promise.all` — runs `fn` over `items` with at most `limit`
 * concurrent invocations. Used to keep file-handle usage sane on machines
 * with low ulimits (macOS defaults to 256) when probing the facet cache
 * across thousands of sessions.
 */
async function pMap<T, U>(items: T[], limit: number, fn: (t: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length)
  const queue = items.entries()
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const [i, item] of queue) out[i] = await fn(item)
  })
  await Promise.all(workers)
  return out
}

async function detectCachedFacets(metas: SessionMeta[]): Promise<Set<string>> {
  // Probe the on-disk facet cache. A hit means `extractFacet` will skip the
  // LLM call and the chunk-summary calls. Concurrency is capped at 20 to
  // avoid EMFILE on machines with low file-descriptor limits when the user
  // has thousands of sessions.
  const hits = await pMap(metas, 20, async (m) =>
    (await loadCachedFacet(m.session_id, m.end_time)) ? m.session_id : null,
  )
  return new Set(hits.filter((id): id is string => id !== null))
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

/**
 * Post-run summary printed once Insights.run resolves. Reports actual cost
 * (computed via `Session.getUsage` from each LLM call's token usage) and
 * wall-clock duration. Only called when `withLLM` is true; deterministic
 * runs have nothing useful to summarize here.
 */
function printRunSummary(r: RunResult, modelLabel: string): void {
  const totalCalls = r.llmCalls.facet + r.llmCalls.chunk_summary + r.llmCalls.section
  const callBreakdown = [
    `${r.llmCalls.facet} facet`,
    r.llmCalls.chunk_summary > 0 ? `${r.llmCalls.chunk_summary} chunk` : null,
    `${r.llmCalls.section} section`,
  ]
    .filter((s): s is string => s !== null)
    .join(" + ")
  const cacheLine =
    r.cachedFacets > 0 ? [`  Cached facets: ${r.cachedFacets} (skipped, $0)`] : []
  const lines = [
    "",
    "Run summary:",
    `  Duration:     ${formatDurationMs(r.durationMs)}`,
    `  LLM calls:    ${totalCalls} (${callBreakdown})`,
    ...cacheLine,
    `  Tokens:       ${r.inputTokens.toLocaleString()} in / ${r.outputTokens.toLocaleString()} out` +
      (r.cacheReadTokens > 0 ? ` · ${r.cacheReadTokens.toLocaleString()} cache-read` : ""),
    `  Actual cost:  $${r.costUSD.toFixed(4)} (${modelLabel})`,
    "",
  ]
  process.stderr.write(lines.join("\n"))
}

/**
 * Pre-flight notice shown before the LLM-confirmation prompt.
 *
 * We deliberately avoid quoting hard cost / token / time numbers up front:
 * actual figures depend on prompt-cache discounts, transcript length variance,
 * provider latency, and reasoning-token rates that the pre-flight estimate
 * doesn't model. A precise-looking "$8.75 / 8m 8s" would mislead more than
 * inform — most real runs come in 30-70% lower thanks to prompt caching.
 *
 * Instead we surface the only two numbers that ARE precise at this stage —
 * the session count and the cache-hit count — and a soft warning. The full
 * post-run breakdown (real cost via `Session.getUsage`, real wall-clock
 * duration) lives in `printRunSummary`, after the run actually completes.
 */
function printPreRunNotice(metas: SessionMeta[], modelLabel: string, cached: ReadonlySet<string>): void {
  const fresh = metas.length - cached.size
  const cachedNote =
    cached.size > 0 ? ` (${cached.size} already cached, ${fresh} need fresh analysis)` : ""
  const lines = [
    "",
    "  About to run LLM analysis.",
    "",
    `  Model:     ${modelLabel}`,
    `  Sessions:  ${metas.length}${cachedNote}`,
    "",
    "  This may take several minutes and consume a non-trivial amount of",
    "  tokens depending on session length and history depth. The exact cost",
    "  depends on prompt caching and provider rates — it's reported once the",
    "  run finishes.",
    "",
  ]
  process.stderr.write(lines.join("\n"))
}

const handleModelMissing = <A, R>(eff: Effect.Effect<A, never, R>, requested: string | undefined) =>
  eff.pipe(
    Effect.catchDefect((e) => {
      // ModelNotFoundError is the typed error raised by `getModel` when a
      // provider/model pair doesn't resolve. The other two cases — "no
      // models found" / "no providers found" — surface from `parseModel`
      // when no input is given AND no default is configured. Use the
      // typed `isInstance` for the structured case and fall back to message
      // matching only for the un-typed default-resolution paths.
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const id = requested ?? `${e.data.providerID}/${e.data.modelID}`
        return fail(`Model not found: ${id}. Run 'opencode models' to list available models.`)
      }
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("no models found") || msg.includes("no providers found")) {
        return fail(`No default model configured. Pass --model provider/model or set 'model' in config.`)
      }
      return Effect.die(e)
    }),
  )

export const InsightsCommand = effectCmd({
  command: "insights",
  describe: "generate a usage report from your OpenCode session history",
  builder: (yargs) =>
    yargs
      .option("days", {
        describe: "only sessions from the last N days (positive integer)",
        type: "number",
      })
      .option("project", {
        describe: "project ID filter (omit to include all projects)",
        type: "string",
      })
      .option("limit", {
        describe: "max sessions to analyze (positive integer)",
        type: "number",
      })
      .option("llm", {
        describe: "extract per-session facets and generate narrative sections (use --no-llm to skip)",
        type: "boolean",
        default: true,
      })
      .option("open", {
        describe: "open the report in your browser (use --no-open to skip)",
        type: "boolean",
        default: true,
      })
      .option("model", {
        describe: "model id in 'provider/model' form (default: configured 'model' from config)",
        type: "string",
      })
      .option("yes", {
        describe: "skip the cost-confirmation prompt before LLM analysis",
        type: "boolean",
        default: false,
        alias: "y",
      })
      .check((argv) => {
        // yargs' `type: "number"` accepts any number including NaN, fractional,
        // and negatives. The downstream filters silently produce an empty
        // report on bad input — fail fast here with a helpful message.
        if (argv.days !== undefined && (!Number.isInteger(argv.days) || argv.days < 1)) {
          throw new Error("--days must be a positive integer")
        }
        if (argv.limit !== undefined && (!Number.isInteger(argv.limit) || argv.limit < 1)) {
          throw new Error("--limit must be a positive integer")
        }
        if (argv.model !== undefined && !argv.model.includes("/")) {
          throw new Error(
            `--model must be in 'provider/model' form (got '${argv.model}'). Run 'opencode models' to list available models.`,
          )
        }
        return true
      }),
  handler: Effect.fn("Cli.insights")(function* (args) {
    const withLLM = args.llm

    // Resolve model metadata + LanguageModel up front when LLM mode is on,
    // so that estimation in `onBeforeLLM` has the cost rates available.
    const llmModels = withLLM
      ? yield* Effect.all({
          metadata: handleModelMissing(resolveModelMetadata(args.model), args.model),
          language: handleModelMissing(resolveLanguageModel(args.model), args.model),
        })
      : undefined

    const modelLabel = llmModels ? `${llmModels.metadata.providerID}/${llmModels.metadata.id}` : ""
    const metadata = llmModels?.metadata
    const reporter = withLLM ? makeProgressReporter() : undefined
    const yes = args.yes

    const onBeforeLLM = withLLM
      ? async (metas: SessionMeta[]): Promise<boolean> => {
          if (!metadata) return false
          if (metas.length === 0) {
            // No sessions survived filters — confirming a 0-call run is
            // pointless. Fall through to the deterministic-only path,
            // which produces a (mostly empty) report.
            process.stderr.write("No sessions match the filters — skipping LLM analysis.\n")
            return false
          }
          const cached = await detectCachedFacets(metas)
          printPreRunNotice(metas, modelLabel, cached)
          if (yes) return true
          if (!process.stderr.isTTY) {
            process.stderr.write(
              "Refusing to run LLM analysis non-interactively without --yes.\n" +
                "Re-run with --yes to confirm, or --no-llm to skip LLM analysis.\n",
            )
            return false
          }
          // Use the project's Effect-flavored confirm helper. It returns
          // Option<boolean>: None on Ctrl-C / ESC, Some(true|false) on Yes/No.
          // We treat None and Some(false) the same (cancel = decline).
          const choice = await Effect.runPromise(
            Prompt.confirm({
              message: "Continue with LLM analysis?",
              initialValue: false,
            }),
          )
          if (Option.isNone(choice)) {
            process.stderr.write("Cancelled — generating deterministic-only report.\n")
            return false
          }
          if (!choice.value) {
            process.stderr.write("Declined — generating deterministic-only report.\n")
            return false
          }
          return true
        }
      : undefined

    const result = yield* Effect.acquireUseRelease(
      Effect.sync(() => reporter),
      (rep) =>
        Insights.run({
          days: args.days,
          projectFilter: args.project,
          limit: args.limit,
          withLLM,
          model: llmModels,
          open: args.open,
          onProgress: rep ? (e) => rep.report(e) : undefined,
          onBeforeLLM,
        }),
      (rep) => Effect.sync(() => rep?.finish()),
    )

    console.log(`Report written to ${result.reportPath}`)
    if (withLLM) printRunSummary(result, modelLabel)
  }),
})
