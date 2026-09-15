import { Session } from "@/session/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageV2 } from "../../session/message-v2"
import { SessionID } from "../../session/schema"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { Effect } from "effect"

const formats = ["json", "usage-json", "usage-csv"] as const

type Usage = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

type UsageMessage = {
  info: {
    role: "user" | "assistant"
    providerID?: string
    modelID?: string
    time: {
      created: number
      completed?: number
    }
  }
  parts: SessionV1.Part[]
}

export type UsageExport = ReturnType<typeof usage>

export function usage(session: Pick<Session.Info, "id" | "parentID" | "time">, messages: UsageMessage[]) {
  const tokens: Usage = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  }
  const models = new Map<string, { steps: number; cost: number; tokens: Usage }>()
  const tools = new Map<string, { calls: number; completed: number; errors: number }>()
  let steps = 0
  let cost = 0
  let assistants = 0
  let unfinished = 0
  let missing = 0

  for (const message of messages) {
    if (message.info.role === "assistant") {
      assistants++
      if (message.info.time.completed === undefined) unfinished++
      if (!message.parts.some((part) => part.type === "step-finish")) missing++
    }
    for (const part of message.parts) {
      if (part.type === "tool") {
        const current = tools.get(part.tool) ?? { calls: 0, completed: 0, errors: 0 }
        current.calls++
        if (part.state.status === "completed") current.completed++
        if (part.state.status === "error") current.errors++
        tools.set(part.tool, current)
      }
      if (part.type !== "step-finish") continue
      steps++
      cost += part.cost
      add(tokens, part.tokens)
      if (message.info.role !== "assistant") continue
      const key = `${message.info.providerID}/${message.info.modelID}`
      const current = models.get(key) ?? {
        steps: 0,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      current.steps++
      current.cost += part.cost
      add(current.tokens, part.tokens)
      models.set(key, current)
    }
  }

  return {
    schemaVersion: 1,
    scope: "exported_session_steps" as const,
    sessionID: session.id,
    parentID: session.parentID,
    includesChildren: false,
    time: {
      created: session.time.created,
      updated: session.time.updated,
    },
    steps,
    assistantMessages: assistants,
    unfinishedAssistantMessages: unfinished,
    assistantMessagesWithoutUsage: missing,
    cost,
    tokens: {
      ...tokens,
      processed: processed(tokens),
    },
    models: [...models].map(([model, value]) => ({
      model,
      ...value,
      tokens: { ...value.tokens, processed: processed(value.tokens) },
    })),
    tools: [...tools].map(([tool, value]) => ({ tool, ...value })),
  }
}

export function usageCsv(report: UsageExport) {
  const header = [
    "schema_version",
    "scope",
    "session_id",
    "parent_id",
    "includes_children",
    "time_created",
    "time_updated",
    "steps",
    "assistant_messages",
    "unfinished_assistant_messages",
    "assistant_messages_without_usage",
    "cost",
    "tokens_input",
    "tokens_output",
    "tokens_reasoning",
    "tokens_cache_read",
    "tokens_cache_write",
    "tokens_processed",
    "models",
    "tools",
  ]
  const row = [
    report.schemaVersion,
    report.scope,
    report.sessionID,
    report.parentID ?? "",
    report.includesChildren,
    report.time.created,
    report.time.updated,
    report.steps,
    report.assistantMessages,
    report.unfinishedAssistantMessages,
    report.assistantMessagesWithoutUsage,
    report.cost,
    report.tokens.input,
    report.tokens.output,
    report.tokens.reasoning,
    report.tokens.cache.read,
    report.tokens.cache.write,
    report.tokens.processed,
    report.models.map((item) => item.model).join(";"),
    JSON.stringify(report.tools),
  ]
  return `${header.join(",")}\n${row.map(csv).join(",")}\n`
}

function add(total: Usage, value: Usage) {
  total.input += value.input
  total.output += value.output
  total.reasoning += value.reasoning
  total.cache.read += value.cache.read
  total.cache.write += value.cache.write
}

function processed(value: Usage) {
  return value.input + value.output + value.reasoning + value.cache.read + value.cache.write
}

function csv(value: string | number | boolean) {
  const text = String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function redact(kind: string, id: string, value: string) {
  return value.trim() ? `[redacted:${kind}:${id}]` : value
}

function data(kind: string, id: string, value: Record<string, unknown> | undefined) {
  if (!value) return value
  return Object.keys(value).length ? { redacted: `${kind}:${id}` } : value
}

function span(id: string, value: { value: string; start: number; end: number }) {
  return {
    ...value,
    value: redact("file-text", id, value.value),
  }
}

function diff(kind: string, diffs: { file?: string; patch?: string }[] | undefined) {
  return diffs?.map((item, i) => ({
    ...item,
    file: item.file === undefined ? undefined : redact(`${kind}-file`, String(i), item.file),
    patch: item.patch === undefined ? undefined : redact(`${kind}-patch`, String(i), item.patch),
  }))
}

function source(part: SessionV1.FilePart) {
  if (!part.source) return part.source
  if (part.source.type === "symbol") {
    return {
      ...part.source,
      path: redact("file-path", part.id, part.source.path),
      name: redact("file-symbol", part.id, part.source.name),
      text: span(part.id, part.source.text),
    }
  }
  if (part.source.type === "resource") {
    return {
      ...part.source,
      clientName: redact("file-client", part.id, part.source.clientName),
      uri: redact("file-uri", part.id, part.source.uri),
      text: span(part.id, part.source.text),
    }
  }
  return {
    ...part.source,
    path: redact("file-path", part.id, part.source.path),
    text: span(part.id, part.source.text),
  }
}

function filepart(part: SessionV1.FilePart): SessionV1.FilePart {
  return {
    ...part,
    url: redact("file-url", part.id, part.url),
    filename: part.filename === undefined ? undefined : redact("file-name", part.id, part.filename),
    source: source(part),
  }
}

function part(part: SessionV1.Part): SessionV1.Part {
  switch (part.type) {
    case "text":
      return {
        ...part,
        text: redact("text", part.id, part.text),
        metadata: data("text-metadata", part.id, part.metadata),
      }
    case "reasoning":
      return {
        ...part,
        text: redact("reasoning", part.id, part.text),
        metadata: data("reasoning-metadata", part.id, part.metadata),
      }
    case "file":
      return filepart(part)
    case "subtask":
      return {
        ...part,
        prompt: redact("subtask-prompt", part.id, part.prompt),
        description: redact("subtask-description", part.id, part.description),
        command: part.command === undefined ? undefined : redact("subtask-command", part.id, part.command),
      }
    case "tool":
      return {
        ...part,
        metadata: data("tool-metadata", part.id, part.metadata),
        state:
          part.state.status === "pending"
            ? {
                ...part.state,
                input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                raw: redact("tool-raw", part.id, part.state.raw),
              }
            : part.state.status === "running"
              ? {
                  ...part.state,
                  input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                  title: part.state.title === undefined ? undefined : redact("tool-title", part.id, part.state.title),
                  metadata: data("tool-state-metadata", part.id, part.state.metadata),
                }
              : part.state.status === "completed"
                ? {
                    ...part.state,
                    input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                    output: redact("tool-output", part.id, part.state.output),
                    title: redact("tool-title", part.id, part.state.title),
                    metadata: data("tool-state-metadata", part.id, part.state.metadata) ?? part.state.metadata,
                    attachments: part.state.attachments?.map(filepart),
                  }
                : {
                    ...part.state,
                    input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                    metadata: data("tool-state-metadata", part.id, part.state.metadata),
                  },
      }
    case "patch":
      return {
        ...part,
        hash: redact("patch", part.id, part.hash),
        files: part.files.map((item: string, i: number) => redact("patch-file", `${part.id}-${i}`, item)),
      }
    case "snapshot":
      return {
        ...part,
        snapshot: redact("snapshot", part.id, part.snapshot),
      }
    case "step-start":
      return {
        ...part,
        snapshot: part.snapshot === undefined ? undefined : redact("snapshot", part.id, part.snapshot),
      }
    case "step-finish":
      return {
        ...part,
        snapshot: part.snapshot === undefined ? undefined : redact("snapshot", part.id, part.snapshot),
      }
    case "agent":
      return {
        ...part,
        source: !part.source
          ? part.source
          : {
              ...part.source,
              value: redact("agent-source", part.id, part.source.value),
            },
      }
    default:
      return part
  }
}

const partFn = part

function sanitize(data: { info: Session.Info; messages: SessionV1.WithParts[] }) {
  return {
    info: {
      ...data.info,
      title: redact("session-title", data.info.id, data.info.title),
      directory: redact("session-directory", data.info.id, data.info.directory),
      summary: !data.info.summary
        ? data.info.summary
        : {
            ...data.info.summary,
            diffs: diff("session-diff", data.info.summary.diffs),
          },
      revert: !data.info.revert
        ? data.info.revert
        : {
            ...data.info.revert,
            snapshot:
              data.info.revert.snapshot === undefined
                ? undefined
                : redact("revert-snapshot", data.info.id, data.info.revert.snapshot),
            diff:
              data.info.revert.diff === undefined
                ? undefined
                : redact("revert-diff", data.info.id, data.info.revert.diff),
          },
    },
    messages: data.messages.map((msg) => ({
      info:
        msg.info.role === "user"
          ? {
              ...msg.info,
              system: msg.info.system === undefined ? undefined : redact("system", msg.info.id, msg.info.system),
              summary: !msg.info.summary
                ? msg.info.summary
                : {
                    ...msg.info.summary,
                    title:
                      msg.info.summary.title === undefined
                        ? undefined
                        : redact("summary-title", msg.info.id, msg.info.summary.title),
                    body:
                      msg.info.summary.body === undefined
                        ? undefined
                        : redact("summary-body", msg.info.id, msg.info.summary.body),
                    diffs: diff("message-diff", msg.info.summary.diffs),
                  },
            }
          : {
              ...msg.info,
              path: {
                cwd: redact("cwd", msg.info.id, msg.info.path.cwd),
                root: redact("root", msg.info.id, msg.info.path.root),
              },
            },
      parts: msg.parts.map(partFn),
    })),
  }
}

export const ExportCommand = effectCmd({
  command: "export [sessionID]",
  describe: "export session data",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session id to export",
        type: "string",
      })
      .option("sanitize", {
        describe: "redact sensitive transcript and file data",
        type: "boolean",
      })
      .option("format", {
        describe: "output transcript JSON or structured usage",
        choices: formats,
        default: "json" as const,
      }),
  handler: Effect.fn("Cli.export")(function* (args) {
    return yield* run(args)
  }),
})

const run = Effect.fn("Cli.export.body")(function* (args: {
  sessionID?: string
  sanitize?: boolean
  format: (typeof formats)[number]
}) {
  const svc = yield* Session.Service
  let sessionID = args.sessionID ? SessionID.make(args.sessionID) : undefined
  process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

  if (!sessionID) {
    UI.empty()
    prompts.intro("Export session", { output: process.stderr })

    const sessions = yield* svc.list()

    if (sessions.length === 0) {
      prompts.log.error("No sessions found", { output: process.stderr })
      prompts.outro("Done", { output: process.stderr })
      return
    }

    sessions.sort((a, b) => b.time.updated - a.time.updated)

    const selectedSession = yield* Effect.promise(() =>
      prompts.autocomplete({
        message: "Select session to export",
        maxItems: 10,
        options: sessions.map((session) => ({
          label: session.title,
          value: session.id,
          hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
        })),
        output: process.stderr,
      }),
    )

    if (prompts.isCancel(selectedSession)) {
      return yield* Effect.die(new UI.CancelledError())
    }

    sessionID = selectedSession

    prompts.outro("Exporting session...", { output: process.stderr })
  }

  // Match legacy try/catch — catches both typed failures and defects
  // (Session.Service.get throws NotFoundError as a defect, not a typed E).
  return yield* Effect.gen(function* () {
    const sessionInfo = yield* svc.get(sessionID!)
    const messages = yield* svc.messages({ sessionID: sessionInfo.id })

    if (args.format !== "json") {
      const report = usage(sessionInfo, messages)
      process.stdout.write(args.format === "usage-csv" ? usageCsv(report) : JSON.stringify(report, null, 2) + EOL)
      return
    }

    const exportData = { info: sessionInfo, messages }
    process.stdout.write(JSON.stringify(args.sanitize ? sanitize(exportData) : exportData, null, 2))
    process.stdout.write(EOL)
  }).pipe(Effect.catchCause(() => fail(`Session not found: ${sessionID!}`)))
})
