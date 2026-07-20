// Thin bridge between transport output and the footer API.
//
// Transports produce StreamCommit[] and an optional FooterOutput (patch +
// view + subagent state). This module forwards them to footer.append() and
// footer.event() respectively, adding trace writes along the way. It also
// defaults status updates to phase "running" if the caller didn't set a
// phase -- a convenience so transport code doesn't have to repeat that.
import type { FooterApi, FooterOutput, FooterPatch, FooterSubagentState, StreamCommit } from "./types"

type Trace = {
  write(type: string, data?: unknown): void
}

type OutputInput = {
  footer: FooterApi
  trace?: Trace
}

type StreamOutput = {
  commits: StreamCommit[]
  footer?: FooterOutput
}

// Default to "running" phase when a status string arrives without an explicit phase.
function patch(next: FooterPatch): FooterPatch {
  if (typeof next.status === "string" && next.phase === undefined) {
    return {
      phase: "running",
      ...next,
    }
  }

  return next
}

function summarize(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 160) {
      return value
    }

    return {
      type: "string",
      length: value.length,
      preview: `${value.slice(0, 160)}...`,
    }
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
    }
  }

  if (!value || typeof value !== "object") {
    return value
  }

  return {
    type: "object",
    keys: Object.keys(value),
  }
}

function traceCommit(commit: StreamCommit) {
  return {
    ...commit,
    text: summarize(commit.text),
    textLength: commit.text.length,
    part: commit.part
      ? {
          id: commit.part.id,
          tool: commit.part.name,
          state: {
            status: commit.part.state.status,
            input: summarize(commit.part.state.input),
            structured: "structured" in commit.part.state ? summarize(commit.part.state.structured) : undefined,
            content: "content" in commit.part.state ? summarize(commit.part.state.content) : undefined,
            error: "error" in commit.part.state ? summarize(commit.part.state.error) : undefined,
          },
          time: commit.part.time,
        }
      : undefined,
  }
}

export function traceSubagentState(state: FooterSubagentState) {
  return {
    tabs: state.tabs,
    details: Object.fromEntries(
      Object.entries(state.details).map(([sessionID, detail]) => [
        sessionID,
        {
          sessionID,
          commits: detail.commits.map(traceCommit),
        },
      ]),
    ),
    permissions: state.permissions.map((item) => ({
      id: item.id,
      sessionID: item.sessionID,
      action: item.action,
      resources: item.resources,
      source: item.source,
      tool: item.tool
        ? {
            id: item.tool.id,
            name: item.tool.name,
            status: item.tool.state.status,
            input: summarize(item.tool.state.input),
          }
        : undefined,
      metadata: item.metadata
        ? {
            keys: Object.keys(item.metadata),
          }
        : undefined,
    })),
    forms: state.forms.map((item) => ({
      id: item.id,
      sessionID: item.sessionID,
      title: item.title,
      fields: item.fields.map((field) => ({ key: field.key, type: field.type })),
      location: item.location,
    })),
  }
}

// Forwards transport output to the footer: commits go to scrollback, patches update the status bar.
export function writeSessionOutput(input: OutputInput, out: StreamOutput): void {
  for (const commit of out.commits) {
    input.trace?.write("ui.commit", commit)
    input.footer.append(commit)
  }

  if (out.footer?.patch) {
    const next = patch(out.footer.patch)
    input.trace?.write("ui.patch", next)
    input.footer.event({
      type: "stream.patch",
      patch: next,
    })
  }

  if (out.footer?.subagent) {
    input.trace?.write("ui.subagent", traceSubagentState(out.footer.subagent))
    input.footer.event({
      type: "stream.subagent",
      state: out.footer.subagent,
    })
  }

  if (!out.footer?.view) {
    return
  }

  input.trace?.write("ui.patch", {
    view: out.footer.view,
  })
  input.footer.event({
    type: "stream.view",
    view: out.footer.view,
  })
}
