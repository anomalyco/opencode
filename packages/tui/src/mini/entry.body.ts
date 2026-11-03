import { createLanguage } from "../i18n/translate"
import { toolEntryBody } from "./tool"
import { monoPrefix, monoToolText } from "./mono"
import type { RunEntryBody, ScrollbackOptions, StreamCommit } from "./types"

export type EntryFlags = {
  startOnNewLine: boolean
  trailingNewline: boolean
}

const RUN_ENTRY_NONE: RunEntryBody = {
  type: "none",
}

function cleanRunText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function textBody(content: string): RunEntryBody {
  if (!content) {
    return RUN_ENTRY_NONE
  }

  return {
    type: "text",
    content,
  }
}

function codeBody(content: string, filetype?: string): RunEntryBody {
  if (!content) {
    return RUN_ENTRY_NONE
  }

  return {
    type: "code",
    content,
    filetype,
  }
}

function markdownBody(content: string): RunEntryBody {
  if (!content) {
    return RUN_ENTRY_NONE
  }

  return {
    type: "markdown",
    content,
  }
}

function userBody(raw: string, mono: boolean): RunEntryBody {
  if (!raw.trim()) {
    return RUN_ENTRY_NONE
  }

  const lead = raw.match(/^\n+/)?.[0] ?? ""
  const body = lead ? raw.slice(lead.length) : raw
  return textBody(`${lead}${mono ? ">" : "›"} ${body}`)
}

function reasoningBody(raw: string, mono: boolean, language: ReturnType<typeof createLanguage>): RunEntryBody {
  const clean = raw.replace(/\[REDACTED\]/g, "")
  if (!clean) {
    return RUN_ENTRY_NONE
  }

  const lead = clean.match(/^\n+/)?.[0] ?? ""
  const body = lead ? clean.slice(lead.length) : clean
  const mark = "Thinking:"
  if (body.startsWith(mark)) {
    if (mono)
      return textBody(
        `${lead}${language.t("tui.transcript.thinkingTitle", { title: body.slice(mark.length).trimStart() })}`,
      )
    return codeBody(
      `${lead}_${language.t("tui.transcript.thinking")}:_ ${body.slice(mark.length).trimStart()}`,
      "markdown",
    )
  }

  return mono ? textBody(clean) : codeBody(clean, "markdown")
}

function systemBody(raw: string, phase: StreamCommit["phase"]): RunEntryBody {
  return textBody(phase === "progress" ? raw : raw.trim())
}

function monoBody(body: RunEntryBody, language: ReturnType<typeof createLanguage>): RunEntryBody {
  if (body.type === "none" || body.type === "text" || body.type === "markdown") return body
  if (body.type === "code") return textBody(body.content)
  const snapshot = body.snapshot
  // Todo cards are not flattened: the writer draws them with ASCII markers in mono.
  if (snapshot.kind === "todo") return body
  if (snapshot.kind === "code") return textBody(`${snapshot.title}\n${snapshot.content}`)
  if (snapshot.kind === "diff") {
    return textBody(
      snapshot.items
        .map(
          (item) =>
            `${item.title}\n${item.diff.trim() || `-${language.plural("tui.miniTool.lines", item.deletions ?? 0)}`}`,
        )
        .join("\n\n"),
    )
  }
  if (snapshot.kind === "task") {
    return textBody([snapshot.title, ...snapshot.rows, snapshot.tail].filter(Boolean).join("\n"))
  }
  return textBody(
    [
      language.t("tui.transcript.questions"),
      ...snapshot.items.flatMap((item) => [item.question, item.answer]),
      snapshot.tail,
    ]
      .filter(Boolean)
      .join("\n"),
  )
}

export function entryFlags(commit: StreamCommit): EntryFlags {
  if (commit.summary) {
    return {
      startOnNewLine: true,
      trailingNewline: false,
    }
  }

  if (commit.kind === "user") {
    return {
      startOnNewLine: true,
      trailingNewline: false,
    }
  }

  if (commit.kind === "tool") {
    if (commit.phase === "progress") {
      return {
        startOnNewLine: false,
        trailingNewline: false,
      }
    }

    return {
      startOnNewLine: true,
      trailingNewline: true,
    }
  }

  if (commit.kind === "assistant" || commit.kind === "reasoning") {
    if (commit.phase === "progress") {
      return {
        startOnNewLine: false,
        trailingNewline: false,
      }
    }

    return {
      startOnNewLine: true,
      trailingNewline: true,
    }
  }

  if (commit.kind === "error") {
    return {
      startOnNewLine: true,
      trailingNewline: false,
    }
  }

  return {
    startOnNewLine: true,
    trailingNewline: true,
  }
}

export function entryDone(commit: StreamCommit): boolean {
  if (commit.kind === "assistant" || commit.kind === "reasoning") {
    return commit.phase === "final"
  }

  if (commit.kind === "tool") {
    return commit.phase === "final" || (commit.phase === "progress" && commit.toolState === "completed")
  }

  return true
}

export function entryCanStream(commit: StreamCommit, body: RunEntryBody): boolean {
  if (commit.phase !== "progress") {
    return false
  }

  if (body.type === "none") {
    return false
  }

  if (commit.kind === "tool") {
    return commit.toolState !== "completed"
  }

  return commit.kind === "assistant" || commit.kind === "reasoning"
}

export function entryBody(commit: StreamCommit, options?: ScrollbackOptions): RunEntryBody {
  const language = options?.language ?? createLanguage(() => "en")
  if (commit.summary) {
    return RUN_ENTRY_NONE
  }

  const raw = cleanRunText(commit.text)
  const mono = options?.mono === true

  if (commit.image) {
    const caption = raw.trim() || language.t("tui.miniTool.image")
    return commit.kind === "user" ? userBody(caption, mono) : textBody(monoToolText(caption, mono))
  }

  if (commit.kind === "user") {
    return userBody(raw, mono)
  }

  if (commit.kind === "tool") {
    const body = toolEntryBody(commit, raw, options) ?? RUN_ENTRY_NONE
    const result = mono ? monoBody(body, language) : body
    if (!mono || body.type !== "text" || result.type !== "text" || commit.phase === "progress") return result
    return textBody(monoToolText(result.content, true))
  }

  if (commit.kind === "assistant") {
    if (commit.phase === "start") {
      return RUN_ENTRY_NONE
    }

    if (commit.phase === "final") {
      return commit.interrupted ? textBody(language.t("tui.miniTool.assistantInterrupted")) : RUN_ENTRY_NONE
    }

    return markdownBody(raw)
  }

  if (commit.kind === "reasoning") {
    if (commit.phase === "start") {
      return RUN_ENTRY_NONE
    }

    if (commit.phase === "final") {
      return commit.interrupted ? textBody(language.t("tui.miniTool.reasoningInterrupted")) : RUN_ENTRY_NONE
    }

    return reasoningBody(raw, mono, language)
  }

  const body = systemBody(raw, commit.phase)
  if (!mono || body.type !== "text") return body
  return textBody(monoPrefix(body.content, true))
}
