import { Session } from "@/session/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionID } from "../../session/schema"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { Filesystem } from "@/util/filesystem"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { Effect } from "effect"

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

function toolTitle(state: SessionV1.ToolState): string | undefined {
  if (state.status === "completed") return state.title
  if (state.status === "running") return state.title
  if (state.status === "error") return `error: ${state.error}`
  return undefined
}

function toolOutput(state: SessionV1.ToolState): string | undefined {
  if (state.status === "completed") return state.output
  if (state.status === "error") return state.error
  return undefined
}

function partMarkdown(value: SessionV1.Part): string[] {
  if (value.type === "text") return value.text.trim() ? ["", value.text.trim()] : []
  if (value.type === "reasoning")
    return value.text.trim()
      ? ["", "<details><summary>Reasoning</summary>", "", value.text.trim(), "", "</details>"]
      : []
  if (value.type === "tool") {
    const title = toolTitle(value.state)
    const output = toolOutput(value.state)?.trimEnd()
    const head = `**🔧 ${value.tool}**${title ? ` — ${title}` : ""}`
    return output ? ["", head, "", "```", output, "```"] : ["", head]
  }
  return []
}

function messageMarkdown(message: SessionV1.WithParts): string[] {
  const body = message.parts.flatMap(partMarkdown)
  if (body.length === 0) return []
  return ["", message.info.role === "user" ? "## 👤 User" : "## 🤖 Assistant", ...body]
}

function markdown(value: { info: Session.Info; messages: SessionV1.WithParts[] }): string {
  const info = value.info
  const lines: string[] = []
  lines.push(`# ${info.title || info.id}`)
  lines.push("")
  lines.push("| Field | Value |")
  lines.push("| --- | --- |")
  lines.push(`| Session | \`${info.id}\` |`)
  lines.push(`| Directory | \`${info.directory}\` |`)
  if (info.agent) lines.push(`| Agent | ${info.agent} |`)
  if (info.model) lines.push(`| Model | ${info.model.providerID}/${info.model.id} |`)
  lines.push(`| Version | ${info.version} |`)
  lines.push(`| Created | ${new Date(info.time.created).toISOString()} |`)
  lines.push(`| Updated | ${new Date(info.time.updated).toISOString()} |`)
  if (info.cost) lines.push(`| Cost | $${info.cost.toFixed(4)} |`)
  lines.push("")
  lines.push("---")
  for (const message of value.messages) lines.push(...messageMarkdown(message))
  lines.push("")
  return lines.join(EOL)
}

export const ExportCommand = effectCmd({
  command: "export [sessionID]",
  describe: "export session data as JSON or Markdown",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session id to export",
        type: "string",
      })
      .option("sanitize", {
        describe: "redact sensitive transcript and file data (JSON only)",
        type: "boolean",
      })
      .option("format", {
        alias: "f",
        describe: "output format",
        type: "string",
        choices: ["json", "markdown"],
        default: "json",
      })
      .option("output", {
        alias: "o",
        describe: "write to a file instead of stdout",
        type: "string",
      }),
  handler: Effect.fn("Cli.export")(function* (args) {
    return yield* run(args)
  }),
})

const run = Effect.fn("Cli.export.body")(function* (args: {
  sessionID?: string
  sanitize?: boolean
  format?: string
  output?: string
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

    const exportData = { info: sessionInfo, messages }

    const content =
      args.format === "markdown"
        ? markdown(exportData)
        : JSON.stringify(args.sanitize ? sanitize(exportData) : exportData, null, 2)

    if (args.output) {
      yield* Effect.promise(() => Filesystem.write(args.output!, content))
      process.stderr.write(`Wrote ${args.format ?? "json"} export to ${args.output}${EOL}`)
      return
    }

    process.stdout.write(content)
    process.stdout.write(EOL)
  }).pipe(Effect.catchCause(() => fail(`Session not found: ${sessionID!}`)))
})
