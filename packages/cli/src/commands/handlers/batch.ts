import type { PermissionV1 } from "@bolt-ai/core/v1/permission"
import path from "path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

/**
 * Parse a batch file into prompts: one prompt per non-empty line, `#` lines
 * are comments. Lines ending with a backslash continue onto the next line so
 * longer prompts stay expressible.
 */
export function parse(text: string): string[] {
  const joined = text.replace(/\\\r?\n/g, " ")
  return joined
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"))
}

export interface Row {
  index: number
  status: "ok" | "error"
  duration: number
  prompt: string
  detail?: string
}

/** Compact duration for the summary table. */
export function duration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

/** Render the end-of-run summary table. */
export function table(rows: Row[]): string {
  const width = 60
  const header = ["#".padEnd(4), "status".padEnd(7), "time".padEnd(8), "prompt"].join(" ")
  const lines = rows.map((row) => {
    const prompt = row.prompt.length > width ? row.prompt.slice(0, width - 3) + "..." : row.prompt
    const suffix = row.detail ? `  (${row.detail})` : ""
    return [String(row.index).padEnd(4), row.status.padEnd(7), duration(row.duration).padEnd(8), prompt + suffix].join(
      " ",
    )
  })
  const failed = rows.filter((row) => row.status === "error").length
  const summary = `${rows.length - failed}/${rows.length} succeeded`
  return [header, "-".repeat(header.length + width - 6), ...lines, "", summary].join("\n")
}

// Headless execution: never ask questions or enter plan mode, and auto-approve
// edit/bash so a batch entry never blocks on a permission ask.
const RULES: PermissionV1.Ruleset = [
  { permission: "question", action: "deny", pattern: "*" },
  { permission: "plan_enter", action: "deny", pattern: "*" },
  { permission: "plan_exit", action: "deny", pattern: "*" },
  { permission: "edit", action: "allow", pattern: "*" },
  { permission: "bash", action: "allow", pattern: "*" },
]

export const BatchCommand = effectCmd({
  command: "batch <file>",
  describe: "run a queue of prompts sequentially or in parallel with a summary table",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        demandOption: true,
        describe: "file with one prompt per line (# comments, backslash continuations)",
      })
      .option("parallel", {
        type: "number",
        default: 1,
        describe: "number of prompts to run concurrently",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use for every prompt",
      }),
  handler: Effect.fn("Cli.batch")(function* (args) {
    if (!Number.isInteger(args.parallel) || args.parallel < 1) {
      return yield* fail("--parallel must be a positive integer")
    }
    const file = Bun.file(path.resolve(process.cwd(), args.file))
    const exists = yield* Effect.promise(() => file.exists())
    if (!exists) return yield* fail(`Batch file not found: ${args.file}`)
    const prompts = parse(yield* Effect.promise(() => file.text()))
    if (prompts.length === 0) return yield* fail("No prompts found in the batch file.")

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompter = yield* SessionPrompt.Service
    const model = args.model ? parseModel(args.model) : undefined

    const run = Effect.fnUntraced(function* (prompt: string, index: number) {
      const started = Date.now()
      UI.println(`── prompt ${index + 1}/${prompts.length} started ──`)
      const session = yield* sessions.create({
        title: `bolt batch ${index + 1}/${prompts.length}`,
        permission: [...RULES],
      })
      const result = yield* prompter
        .prompt({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          agent: args.agent,
          model,
          parts: [{ id: PartID.ascending(), type: "text", text: prompt }],
        })
        .pipe(Effect.orDie)

      const elapsed = Date.now() - started
      if (result.info.role === "assistant" && result.info.error) {
        const err = result.info.error
        const message = "message" in err.data ? err.data.message : ""
        UI.println(`── prompt ${index + 1} failed: ${err.name} ──`)
        return {
          index: index + 1,
          status: "error",
          duration: elapsed,
          prompt,
          detail: `${err.name}${message ? `: ${message}` : ""}`,
        } satisfies Row
      }

      const text = extractResponseText(result.parts) ?? ""
      if (!text) {
        UI.println(`── prompt ${index + 1} returned an empty response ──`)
        return { index: index + 1, status: "error", duration: elapsed, prompt, detail: "empty response" } satisfies Row
      }

      UI.empty()
      UI.println(`── prompt ${index + 1} finished (${duration(elapsed)}) ──`)
      UI.println(UI.markdown(text))
      UI.empty()
      return { index: index + 1, status: "ok", duration: elapsed, prompt } satisfies Row
    })

    const rows = yield* Effect.forEach(prompts, (prompt, index) => run(prompt, index), {
      concurrency: args.parallel,
    })

    UI.empty()
    UI.println(table(rows))
    if (rows.some((row) => row.status === "error")) process.exitCode = 1
  }),
})
