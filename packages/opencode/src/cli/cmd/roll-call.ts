import { generateText } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Cause, Effect, Exit } from "effect"
import { EOL } from "os"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

const DEFAULT_PROMPT = "Hello"
const DEFAULT_TIMEOUT = 25_000
const DEFAULT_PARALLEL = 5
const MAX_CELL_LENGTH = 96
const TABLE_PADDING = " | "

export type RollCallOutput = "table" | "json" | "md"

export type RollCallResult = {
  model: string
  success: boolean
  snippet: string
  latency: number
  errorType: string | null
  errorMessage: string | null
}

type ProbeOutcome =
  | { type: "success"; text: string }
  | { type: "error"; error: unknown }
  | { type: "timeout"; timeout: number }

type RollCallProbe = (language: LanguageModelV3, model: Provider.Model, signal: AbortSignal) => Promise<string>

export type RollCallTableOptions = {
  width?: number
  color?: boolean
}

export type RunRollCallInput = {
  provider: Provider.Interface
  models: Provider.Model[]
  prompt: string
  timeout: number
  parallel: number
  probe?: RollCallProbe
  onResult?: (result: RollCallResult) => void
}

export function isTextModel(model: Provider.Model) {
  return model.capabilities.input.text && model.capabilities.output.text
}

export function matchingModels(providers: Record<string, Provider.Info>, filter: RegExp) {
  const matcher = new RegExp(filter.source, filter.flags.replaceAll("g", "").replaceAll("y", ""))
  return Object.entries(providers)
    .flatMap(([providerID, provider]) =>
      Object.values(provider.models).filter((model) => matcher.test(`${providerID}/${model.id}`)),
    )
    .filter(isTextModel)
    .sort((a, b) => modelName(a).localeCompare(modelName(b)))
}

export function validateRollCallOptions(input: { filter: string; timeout: number; parallel: number }) {
  if (!input.filter.trim()) return "A non-empty model filter is required"
  if (!Number.isInteger(input.timeout) || input.timeout <= 0) return "--timeout must be a positive integer"
  if (!Number.isInteger(input.parallel) || input.parallel <= 0) return "--parallel must be a positive integer"
  try {
    new RegExp(input.filter, "i")
  } catch {
    return `Invalid model filter regex: ${input.filter}`
  }
  return undefined
}

export const runRollCall = Effect.fn("Cli.rollCall.run")(function* (input: RunRollCallInput) {
  const models = [...input.models].sort((a, b) => modelName(a).localeCompare(modelName(b)))
  const results = yield* Effect.all(
    models.map((model) =>
      Effect.gen(function* () {
        const started = performance.now()
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const language = yield* input.provider.getLanguage(model)
            return yield* Effect.promise(() => probe(language, model, input))
          }),
        )
        const latency = Math.round(performance.now() - started)
        const result = Exit.isSuccess(exit)
          ? resultFromProbe(model, latency, exit.value)
          : failedResult(model, latency, "provider", Cause.pretty(exit.cause))
        const onResult = input.onResult
        if (onResult) yield* Effect.sync(() => onResult(result))
        return result
      }),
    ),
    { concurrency: input.parallel },
  )
  return results
})

export function formatRollCallTable(results: RollCallResult[], options: RollCallTableOptions = {}) {
  const rows = results.map((result) => ({
    model: displayCell(result.model),
    access: result.success ? "YES" : "NO",
    snippet: displayCell(result.success ? result.snippet : `(${result.errorMessage || "error"})`),
    latency: `${result.latency}ms`,
    success: result.success,
  }))
  const width = options.width ?? terminalWidth()
  const modelWidth = Math.min(
    Math.max(4, ...rows.map((row) => row.model.length)),
    Math.max(1, width - TABLE_PADDING.length * 3 - 6 - 7 - "Snippet".length),
  )
  const accessWidth = Math.max(6, ...rows.map((row) => row.access.length))
  const latencyWidth = Math.max(7, ...rows.map((row) => row.latency.length))
  const snippetWidth = Math.max(
    1,
    Math.min(MAX_CELL_LENGTH, width - TABLE_PADDING.length * 3 - modelWidth - accessWidth - latencyWidth),
  )
  const columns = [
    ["Model", ...rows.map((row) => truncateCell(row.model, modelWidth))],
    ["Access", ...rows.map((row) => row.access)],
    ["Snippet", ...rows.map((row) => truncateCell(row.snippet, snippetWidth))],
    ["Latency", ...rows.map((row) => row.latency)],
  ]
  const widths = [modelWidth, accessWidth, snippetWidth, latencyWidth]
  const line = (row: string[]) =>
    row
      .map((cell, index) => truncateCell(cell, widths[index]).padEnd(widths[index]))
      .join(TABLE_PADDING)
      .trimEnd()
  const color = options.color ?? process.stderr.isTTY === true
  const output = [
    line(columns.map((column) => column[0])),
    widths.map((cellWidth) => "-".repeat(cellWidth)).join("-+-"),
    ...rows.map((row, index) => paint(line(columns.map((column) => column[index + 1])), row.success, color)),
  ]
  return output.join(EOL) + EOL
}

export function formatRollCallJson(results: RollCallResult[]) {
  return JSON.stringify(results, null, 2) + EOL
}

export function formatRollCallMarkdown(results: RollCallResult[]) {
  const rows = [
    ["Model", "Access", "Snippet", "Latency", "Error Type", "Error Message"],
    ...results.map((result) => [
      result.model,
      result.success ? "YES" : "NO",
      result.snippet,
      `${result.latency}ms`,
      result.errorType ?? "",
      result.errorMessage ?? "",
    ]),
  ]
  return (
    [
      `| ${rows[0].join(" | ")} |`,
      `| ${rows[0].map(() => "---").join(" | ")} |`,
      ...rows.slice(1).map((row) => `| ${row.map((cell) => markdownCell(cell)).join(" | ")} |`),
    ].join(EOL) + EOL
  )
}

export function formatRollCall(results: RollCallResult[], output: RollCallOutput, options?: RollCallTableOptions) {
  if (output === "json") return formatRollCallJson(results)
  if (output === "md") return formatRollCallMarkdown(results)
  return formatRollCallTable(results, options)
}

export const RollCallCommand = effectCmd({
  command: "roll-call <filter>",
  describe: "test matching text models for connectivity and latency",
  builder: (yargs) =>
    yargs
      .positional("filter", {
        describe: "case-insensitive regex used to select models",
        type: "string",
      })
      .option("prompt", {
        describe: "prompt sent to each model",
        type: "string",
        default: DEFAULT_PROMPT,
      })
      .option("timeout", {
        describe: "per-model timeout in milliseconds",
        type: "number",
        default: DEFAULT_TIMEOUT,
      })
      .option("parallel", {
        describe: "maximum concurrent model calls",
        type: "number",
        default: DEFAULT_PARALLEL,
      })
      .option("verbose", {
        describe: "show per-model progress in table mode",
        type: "boolean",
        default: false,
      })
      .option("quiet", {
        describe: "suppress progress output",
        type: "boolean",
        default: false,
      })
      .option("output", {
        describe: "output format",
        type: "string",
        choices: ["table", "json", "md"],
        default: "table",
      }),
  handler: Effect.fn("Cli.rollCall")(function* (args) {
    const validation = validateRollCallOptions({
      filter: args.filter,
      timeout: args.timeout,
      parallel: args.parallel,
    })
    if (validation) return yield* fail(validation)

    const filter = new RegExp(args.filter, "i")
    const provider = yield* Provider.Service
    const providers = yield* provider.list()
    const models = matchingModels(providers, filter)
    const output = args.output as RollCallOutput
    const human = output === "table"

    if (models.length === 0) {
      if (human) {
        if (!args.quiet) writeHumanIntro(args.prompt, args.timeout, args.parallel, 0)
        process.stderr.write(formatRollCallTable([]))
      } else {
        process.stdout.write(formatRollCall([], output))
      }
      return yield* fail(`No text models matched: ${args.filter}`)
    }

    if (human && !args.quiet) writeHumanIntro(args.prompt, args.timeout, args.parallel, models.length)

    const results = yield* runRollCall({
      provider,
      models,
      prompt: args.prompt,
      timeout: args.timeout,
      parallel: args.parallel,
      onResult:
        human && args.verbose && !args.quiet
          ? (result) => process.stderr.write(formatRollCallProgress(result) + EOL)
          : undefined,
    })
    if (human) {
      process.stderr.write(formatRollCallTable(results))
      if (!args.quiet) writeHumanSummary(results)
      return
    }
    process.stdout.write(formatRollCall(results, output))
  }),
})

function modelName(model: Provider.Model) {
  return `${model.providerID}/${model.id}`
}

function probe(language: LanguageModelV3, model: Provider.Model, input: RunRollCallInput) {
  const controller = new AbortController()
  const request = Promise.resolve()
    .then(() =>
      input.probe
        ? input.probe(language, model, controller.signal)
        : generateText({
            model: language,
            prompt: input.prompt,
            maxOutputTokens: 128,
            maxRetries: 0,
            abortSignal: controller.signal,
            headers: model.headers,
            providerOptions: ProviderTransform.providerOptions(model, model.options),
          }).then((result) => result.text),
    )
    .then(
      (text): ProbeOutcome => ({ type: "success", text }),
      (error): ProbeOutcome => ({ type: "error", error }),
    )

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ProbeOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ type: "timeout", timeout: input.timeout })
    }, input.timeout)
  })
  return Promise.race([request, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function resultFromProbe(model: Provider.Model, latency: number, outcome: ProbeOutcome): RollCallResult {
  if (outcome.type === "success") {
    return {
      model: modelName(model),
      success: true,
      snippet: truncate(sanitize(outcome.text)),
      latency,
      errorType: null,
      errorMessage: null,
    }
  }
  if (outcome.type === "timeout") return failedResult(model, latency, "timeout", `Timed out after ${outcome.timeout}ms`)
  const error = describeError(outcome.error)
  return failedResult(model, latency, error.type, error.message)
}

function failedResult(model: Provider.Model, latency: number, errorType: string, errorMessage: string): RollCallResult {
  return {
    model: modelName(model),
    success: false,
    snippet: "",
    latency,
    errorType: truncate(sanitize(errorType)),
    errorMessage: truncate(sanitize(errorMessage)),
  }
}

function describeError(error: unknown) {
  if (error instanceof Error) return { type: error.name || "Error", message: error.message }
  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>
    const type = typeof value._tag === "string" ? value._tag : "Error"
    const message = typeof value.message === "string" ? value.message : String(error)
    return { type, message }
  }
  return { type: "Error", message: String(error) }
}

function sanitize(value: string) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b(?:[@-_]|\[[0-?]*[ -\/]*[@-~])/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function truncate(value: string) {
  return value.length > MAX_CELL_LENGTH ? value.slice(0, MAX_CELL_LENGTH - 1) + "…" : value
}

function displayCell(value: string) {
  return truncate(sanitize(value))
}

function terminalWidth() {
  const columns = Number.parseInt(process.env.COLUMNS ?? "", 10)
  if (Number.isInteger(columns) && columns > 0) return columns
  if (process.stdout.columns && process.stdout.columns > 0) return process.stdout.columns
  return 80
}

function truncateCell(value: string, width: number) {
  if (value.length <= width) return value
  if (width <= 1) return "…"
  return value.slice(0, width - 1) + "…"
}

function paint(value: string, success: boolean, color: boolean) {
  if (!color) return value
  return (success ? UI.Style.TEXT_SUCCESS : UI.Style.TEXT_DANGER) + value + UI.Style.TEXT_NORMAL
}

export function formatRollCallProgress(result: RollCallResult, color = process.stderr.isTTY === true) {
  const model = displayCell(result.model)
  if (result.success) return paint(`✔ ${model} (${result.latency}ms)`, true, color)
  return paint(`✘ ${model} (${displayCell(result.errorMessage ?? "error")})`, false, color)
}

export function formatRollCallIntro(
  prompt: string,
  timeout: number,
  parallel: number,
  modelCount: number,
  color = process.stderr.isTTY === true,
) {
  const lines = [
    `Starting roll call for models with prompt: "${sanitize(prompt)}"`,
    `Timeout per model: ${timeout}ms, Parallel calls: ${parallel}`,
    `Prompting ${modelCount} models...`,
  ]
  return lines.map((line) => (color ? UI.Style.TEXT_HIGHLIGHT + line + UI.Style.TEXT_NORMAL : line)).join(EOL) + EOL
}

function writeHumanIntro(prompt: string, timeout: number, parallel: number, modelCount: number) {
  process.stderr.write(formatRollCallIntro(prompt, timeout, parallel, modelCount))
}

export function formatRollCallSummary(results: RollCallResult[], color = process.stderr.isTTY === true) {
  const accessible = results.filter((result) => result.success).length
  const failed = results.length - accessible
  const accessibleText = color
    ? UI.Style.TEXT_SUCCESS + `Accessible: ${accessible}` + UI.Style.TEXT_NORMAL
    : `Accessible: ${accessible}`
  const failedText = color ? UI.Style.TEXT_DANGER + `Failed: ${failed}` + UI.Style.TEXT_NORMAL : `Failed: ${failed}`
  return `${accessibleText} | ${failedText}${EOL}`
}

function writeHumanSummary(results: RollCallResult[]) {
  process.stderr.write(formatRollCallSummary(results))
}

function markdownCell(value: string) {
  return displayCell(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|")
}
