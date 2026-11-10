import { mkdir, chmod } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { parseArgs } from "node:util"
import { Effect, Result, Schema } from "effect"
import { ShellTool } from "../src/tool/plugin/shell.js"
import { definition } from "../src/tool/runtime.js"

const shellID = "sh_eval_running"
const outputPath = "/workspace/verify.out"

export const cases = [
  {
    id: "quick",
    command: "node quick.mjs",
    kind: "quick",
    prompt: "Run `node quick.mjs`. It exits in under a second. Report its result.",
  },
  {
    id: "long-result",
    command: "node verify.mjs",
    kind: "survive",
    prompt: "Run `node verify.mjs`. It normally takes five minutes. I need its result before your final answer.",
  },
  {
    id: "independent-work",
    command: "node build.mjs",
    kind: "responsive",
    prompt: "Start `node build.mjs`, which takes five minutes, then continue updating the README while it works.",
  },
  {
    id: "inner-limit",
    command: "timeout 600 node verify.mjs",
    kind: "survive",
    prompt:
      "Run `timeout 600 node verify.mjs` exactly as written. Verification normally takes five minutes; collect its result when it finishes.",
  },
  {
    id: "hard-deadline",
    command: "node worker.mjs",
    kind: "deadline",
    prompt:
      "Run `node worker.mjs`, but terminate the process if it exceeds five seconds. Do not leave it running afterward. Use the tool's timeout controls rather than wrapping the command.",
  },
  {
    id: "server",
    command: "node server.mjs",
    kind: "responsive",
    prompt:
      "Start `node server.mjs` as a development server and keep it available while we work. Return control promptly; do not wait for it to exit.",
  },
  {
    id: "progress",
    command: "node verify.mjs",
    kind: "progress",
    prompt: "What progress has the verification made?",
    continuation: true,
  },
  {
    id: "cancel",
    command: "node verify.mjs",
    kind: "cancel",
    prompt: "Cancel that verification job now.",
    continuation: true,
  },
] as const

export type Case = (typeof cases)[number]
export type Call = { name: string; input: unknown }

const read = {
  name: "read",
  description: "Read a file's current contents.",
  input: Schema.Struct({ path: Schema.String }),
}
const stop = {
  name: "shell_stop",
  description: "Stop a running shell by its shell ID.",
  input: Schema.Struct({ shellID: Schema.String }),
}
const recordOnly = () => Effect.die("This eval records decisions and never executes tools.")

export function tools(candidate: boolean) {
  return [
    { name: "shell", description: ShellTool.description("bash", candidate), input: ShellTool.input(candidate) },
    read,
    stop,
  ].map((tool) => {
    const value = definition({ ...tool, execute: recordOnly })
    return {
      type: "function",
      function: { name: value.name, description: value.description, parameters: value.inputSchema },
    }
  })
}

export function messages(item: Case, candidate: boolean) {
  const history: object[] = [
    {
      role: "system",
      content:
        "You are a coding assistant. Use the available tools to carry out the user's request. The working directory is /workspace.",
    },
  ]
  if ("continuation" in item) {
    history.push(
      { role: "user", content: "Run node verify.mjs. It normally takes five minutes." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_started",
            type: "function",
            function: {
              name: "shell",
              arguments: JSON.stringify(
                candidate ? { command: item.command, timeout: 1000 } : { command: item.command, background: true },
              ),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_started",
        content: ShellTool.resultMessages(
          ShellTool.backgroundResult(shellID, outputPath, candidate ? 1000 : undefined),
        ).join("\n\n"),
      },
    )
  }
  return [...history, { role: "user", content: item.prompt }]
}

export function score(item: Case, calls: Call[], candidate: boolean) {
  const shellCalls = calls.filter((call) => call.name === "shell")
  const decoded = shellCalls.map((call) => Schema.decodeUnknownResult(ShellTool.input(candidate))(call.input))
  const reads = calls
    .filter((call) => call.name === read.name)
    .map((call) => Schema.decodeUnknownResult(read.input)(call.input))
  const stops = calls
    .filter((call) => call.name === stop.name)
    .map((call) => Schema.decodeUnknownResult(stop.input)(call.input))
  const valid =
    decoded.length + reads.length + stops.length === calls.length &&
    decoded.every(Result.isSuccess) &&
    reads.every(Result.isSuccess) &&
    stops.every(Result.isSuccess)
  const inputs = decoded.flatMap((result) => (Result.isSuccess(result) ? [result.success] : []))
  const started = inputs.filter((input) => input.command.includes(item.command))
  const command = started.length === 1
  const duplicate = "continuation" in item && started.length > 0
  const first = started[0]
  const waitMs = first?.background
    ? 0
    : first?.timeout === 0
      ? Infinity
      : (first?.timeout ?? ShellTool.DEFAULT_TIMEOUT_MS)
  const killMs = first?.background || !candidate ? first?.timeout || Infinity : Infinity
  const effectiveKillMs =
    first?.background && first.timeout === undefined
      ? Infinity
      : !candidate && first?.timeout === undefined
        ? ShellTool.DEFAULT_TIMEOUT_MS
        : killMs
  const bounded = effectiveKillMs <= 5000
  const cancelled = stops.some((result) => Result.isSuccess(result) && result.success.shellID === shellID)
  const progress =
    reads.some(
      (result) => Result.isSuccess(result) && path.posix.resolve("/workspace", result.success.path) === outputPath,
    ) ||
    inputs.some((input) => {
      if (!/\b(?:cat|head|tail|sed|grep|rg)\b/.test(input.command)) return false
      const paths = input.command.match(/[^\s'";|&]+verify\.out\b|\bverify\.out\b/g) ?? []
      return paths.some((file) => path.posix.resolve("/workspace", input.workdir ?? ".", file) === outputPath)
    })
  const action =
    item.kind === "progress"
      ? progress && !duplicate && !cancelled
      : item.kind === "cancel"
        ? cancelled && !duplicate
        : item.kind === "deadline"
          ? command && bounded
          : item.kind === "quick"
            ? command && !first?.background && waitMs !== 0
            : item.kind === "responsive"
              ? command && effectiveKillMs >= 300_000 && waitMs <= 30_000
              : command && effectiveKillMs >= 300_000
  return {
    score: Number(valid && action),
    validToolArguments: valid,
    requestedCommand: command,
    needsMoreSteps: !("continuation" in item) && valid && !command,
    duplicateLaunch: duplicate,
    shellCalls: shellCalls.length,
    waitMs: first && Number.isFinite(waitMs) ? waitMs : null,
    killMs: first && Number.isFinite(effectiveKillMs) ? effectiveKillMs : null,
  }
}

const Response = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  choices: Schema.Array(
    Schema.Struct({
      finish_reason: Schema.NullOr(Schema.String),
      message: Schema.Struct({
        tool_calls: Schema.optionalKey(
          Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String, arguments: Schema.String }) })),
        ),
      }),
    }),
  ),
  usage: Schema.optionalKey(
    Schema.Struct({
      prompt_tokens: Schema.optionalKey(Schema.Number),
      completion_tokens: Schema.optionalKey(Schema.Number),
      cost: Schema.optionalKey(Schema.Number),
    }),
  ),
})

async function run() {
  const args = parseArgs({
    options: {
      out: { type: "string" },
      models: {
        type: "string",
        default: "deepseek-v4.1-flash,glm-5.3-flash,minimax-m3,claude-haiku-5-5,gemini-3.5-flash-lite",
      },
      reps: { type: "string", default: "2" },
      concurrency: { type: "string", default: "4" },
      cases: { type: "string" },
    },
  }).values
  if (!args.out) throw new Error("Pass --out with a new private results directory")
  if (!process.env.OPENCODE_API_KEY) throw new Error("OPENCODE_API_KEY is required")
  if (![args.reps, args.concurrency].every((value) => Number.isInteger(Number(value)) && Number(value) > 0))
    throw new Error("Repetitions and concurrency must be positive integers")
  const models = (args.models ?? "").split(",")
  if (!models.every((model) => /^[a-z0-9._-]+$/i.test(model))) throw new Error("Use comma-separated provider model IDs")
  const output = path.resolve(args.out)
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
  await mkdir(output, { mode: 0o700 })
  const selected = cases.filter((item) => !args.cases || args.cases.split(",").includes(item.id))
  if (selected.length === 0) throw new Error("No matching cases")
  const tasks = models.flatMap((model) =>
    selected.flatMap((item) =>
      [false, true].flatMap((candidate) =>
        Array.from({ length: Number(args.reps) }, (_, rep) => ({ model, item, candidate, rep })),
      ),
    ),
  )
  const queue = [...tasks]
  const rows: object[] = []
  const manifest = {
    started: new Date().toISOString(),
    scope: "Model tool-choice microeval; tools are never executed. Runtime behavior is tested separately.",
    models,
    reps: Number(args.reps),
    cases: selected,
    variants: ["baseline", "candidate"],
    definitions: { baseline: tools(false), candidate: tools(true) },
    sourceHashes: Object.fromEntries(
      await Promise.all(
        [
          import.meta.path,
          path.join(import.meta.dir, "../src/tool/plugin/shell.ts"),
          path.join(import.meta.dir, "../../schema/src/config/flag.ts"),
        ].map(async (file) => [
          path.relative(path.join(import.meta.dir, "../../.."), file),
          createHash("sha256")
            .update(new Uint8Array(await Bun.file(file).arrayBuffer()))
            .digest("hex"),
        ]),
      ),
    ),
    trials: tasks.length,
  }
  await Bun.write(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2))
  const worker = async (): Promise<void> => {
    const task = queue.shift()
    if (!task) return
    const variant = task.candidate ? "candidate" : "baseline"
    const id = `${task.model}--${task.item.id}--${variant}--${task.rep}`
    const body = JSON.stringify({
      model: task.model,
      messages: messages(task.item, task.candidate),
      tools: tools(task.candidate),
      max_tokens: 4096,
      ...(task.model.startsWith("deepseek-") || task.model.startsWith("glm-") ? { reasoning_effort: "high" } : {}),
    })
    const started = Date.now()
    await Bun.write(path.join(output, `${id}.request.json`), body)
    const result = await (async () => {
      const response = await fetch("https://opencode.ai/inference/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPENCODE_API_KEY}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(180_000),
      })
      const raw = await response.text()
      await Bun.write(path.join(output, `${id}.capture.json`), raw)
      await chmod(path.join(output, `${id}.capture.json`), 0o600)
      if (!response.ok) return { runError: `http_${response.status}`, scores: null, usage: null }
      const data = Schema.decodeUnknownSync(Response)(JSON.parse(raw))
      const choice = data.choices[0]
      if (!choice || choice.finish_reason === "length")
        return { runError: choice ? "output_limit" : "missing_choice", scores: null, usage: data.usage ?? null }
      const calls = (choice.message.tool_calls ?? []).map(
        (call): Call => ({
          name: call.function.name,
          input: Result.try(() => JSON.parse(call.function.arguments)).pipe(Result.getOrNull),
        }),
      )
      return {
        runError: null,
        finish: choice.finish_reason,
        calls,
        scores: score(task.item, calls, task.candidate),
        usage: data.usage ?? null,
      }
    })().then(Result.succeed, Result.fail)
    const row = {
      id,
      model: task.model,
      case: task.item.id,
      variant,
      rep: task.rep,
      requestHash: createHash("sha256").update(body).digest("hex"),
      ms: Date.now() - started,
      ...(Result.isSuccess(result)
        ? result.success
        : {
            runError: result.failure instanceof Error ? result.failure.name : "request_error",
            scores: null,
            usage: null,
          }),
    }
    await Bun.write(path.join(output, `${id}.json`), JSON.stringify(row, null, 2))
    rows.push(row)
    console.log(
      JSON.stringify({
        completed: rows.length,
        total: tasks.length,
        id,
        runError: row.runError,
        score: row.scores?.score ?? null,
      }),
    )
    return worker()
  }
  await Promise.all(Array.from({ length: Number(args.concurrency) }, worker))
  await Bun.write(
    path.join(output, "summary.json"),
    JSON.stringify({ ...manifest, finished: new Date().toISOString(), rows }, null, 2),
  )
}

if (import.meta.main) await run()
