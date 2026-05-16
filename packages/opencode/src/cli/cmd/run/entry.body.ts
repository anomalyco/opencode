import { toolEntryBody } from "./tool"
import type { RunEntryBody, StreamCommit } from "./types"

export type EntryFlags = {
  startOnNewLine: boolean
  trailingNewline: boolean
}

export const RUN_ENTRY_NONE: RunEntryBody = {
  type: "none",
}

export function cleanRunText(text: string): string {
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

function userBody(raw: string): RunEntryBody {
  if (!raw.trim()) {
    return RUN_ENTRY_NONE
  }

  const lead = raw.match(/^\n+/)?.[0] ?? ""
  const body = lead ? raw.slice(lead.length) : raw
  return textBody(`${lead}› ${body}`)
}

function reasoningBody(raw: string): RunEntryBody {
  const clean = raw.replace(/\[REDACTED\]/g, "")
  if (!clean) {
    return RUN_ENTRY_NONE
  }

  const lead = clean.match(/^\n+/)?.[0] ?? ""
  const body = lead ? clean.slice(lead.length) : clean
  const mark = "Thinking:"
  if (body.startsWith(mark)) {
    return codeBody(`${lead}_Thinking:_ ${body.slice(mark.length).trimStart()}`, "markdown")
  }

  return codeBody(clean, "markdown")
}

function systemBody(raw: string, phase: StreamCommit["phase"]): RunEntryBody {
  return textBody(phase === "progress" ? raw : raw.trim())
}

export function entryFlags(commit: StreamCommit): EntryFlags {
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

export function entryBody(commit: StreamCommit): RunEntryBody {
  const raw = cleanRunText(commit.text)

  if (commit.kind === "user") {
    return userBody(raw)
  }

  if (commit.kind === "tool") {
    return toolEntryBody(commit, raw) ?? RUN_ENTRY_NONE
  }

  if (commit.kind === "assistant") {
    if (commit.phase === "start") {
      return RUN_ENTRY_NONE
    }

    if (commit.phase === "final") {
      return commit.interrupted ? textBody("assistant interrupted") : RUN_ENTRY_NONE
    }

    return markdownBody(raw)
  }

  if (commit.kind === "reasoning") {
    if (commit.phase === "start") {
      return RUN_ENTRY_NONE
    }

    if (commit.phase === "final") {
      return commit.interrupted ? textBody("reasoning interrupted") : RUN_ENTRY_NONE
    }

    return reasoningBody(raw)
  }

  return systemBody(raw, commit.phase)
}
