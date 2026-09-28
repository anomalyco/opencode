// Text renderer (ARCHITECTURE §11, SPEC §9). stdout carries only the main agent's text, written unbuffered as each
// delta arrives. Everything else goes to stderr: reasoning (dim, unless --no-thinking), the status line (one
// in-place line on a TTY, cleared by the next output), tool lines (`⚙` at start, rewritten in place as `✓`/`✗` at
// the end on a TTY), step token counts and errors. Sub-agent output is indented by its agent_path depth.
import { Effect } from "effect"
import type { EventSink, RenderEvent } from "../contract"
import { cleanEvent, duration, stepLine, toolLine } from "./event"

export interface TextSinkOptions {
  showThinking: boolean
  tty: boolean
  /** ANSI dim/erase codes; default: tty and NO_COLOR unset. */
  color?: boolean
  out?: (text: string) => void
  err?: (text: string) => void
}

type Stream = "text" | "reasoning" | "line"

export function textSink(options: TextSinkOptions): EventSink {
  const out = options.out ?? ((text: string) => void process.stdout.write(text))
  const err = options.err ?? ((text: string) => void process.stderr.write(text))
  const color = options.color ?? (options.tty && !process.env.NO_COLOR)
  const tty = options.tty
  const dim = (text: string) => (color ? `\x1b[2m${text}\x1b[22m` : text)
  const state = {
    stream: "line" as Stream,
    /** An in-place status line is on screen (TTY only). */
    status: false,
    /** call_id of the `⚙` line the cursor sits on (TTY only). */
    tool: undefined as string | undefined,
    /** stdout / stderr stream text not yet ended with a newline. */
    outOpen: false,
    errOpen: false,
  }

  // Leave whatever is on the current line so `next` starts clean.
  const settle = (next: Stream) => {
    if (state.status) err("\r\x1b[K")
    state.status = false
    if (state.tool !== undefined) err("\n")
    state.tool = undefined
    if (state.stream === "text" && next !== "text" && state.outOpen) out("\n")
    if (state.stream === "reasoning" && next !== "reasoning") err(`${color ? "\x1b[22m" : ""}${state.errOpen ? "\n" : ""}`)
    if (state.stream !== next) state.outOpen = state.errOpen = false
    state.stream = next
  }
  const line = (text: string, indent: string) => {
    settle("line")
    err(`${indent}${text}\n`)
  }
  const status = (text: string, indent: string, persistent: boolean) => {
    if (!tty || persistent) return line(text, indent)
    settle("line")
    err(`\r\x1b[K${indent}${dim(text)}`)
    state.status = true
  }
  const toStderr = (text: string, indent: string) => {
    if (state.stream !== "reasoning") settle("reasoning")
    if (!state.errOpen) err(indent + (color ? "\x1b[2m" : ""))
    const ended = text.endsWith("\n")
    err((ended ? text.slice(0, -1) : text).replaceAll("\n", `\n${indent}`) + (ended ? "\n" : ""))
    state.errOpen = !ended
  }

  const render = (event: RenderEvent) => {
    const indent = "  ".repeat(event.agent_path.length)
    switch (event.type) {
      case "status":
        return status(statusText(event), indent, ["notice", "retry", "permission"].includes(event.phase))
      case "system":
        return status(`${event.agent} · ${event.model} · ${event.profile} · ${event.tools.length} tools`, indent, false)
      case "text_delta":
        // Only the main agent's answer is stdout; a sub-agent's text is progress, like reasoning.
        if (event.agent_path.length > 0) return toStderr(event.text, indent)
        if (state.stream !== "text") settle("text")
        out(event.text)
        state.outOpen = !event.text.endsWith("\n")
        return
      case "reasoning_delta":
        if (!options.showThinking) return
        return toStderr(event.text, indent)
      case "tool_start":
        if (!tty) return line(`⚙ ${event.summary}`, indent)
        settle("line")
        err(`${indent}⚙ ${event.summary}`)
        state.tool = event.call_id
        return
      case "tool_end":
        if (!tty || state.tool !== event.call_id) return line(toolLine(event), indent)
        err(`\r\x1b[K${indent}${toolLine(event)}\n`)
        state.tool = undefined
        return
      case "step_finish":
        return line(dim(stepLine(event.step, event.usage)), indent)
      case "error":
        return line(`error: ${event.message}`, indent)
      case "result":
        return settle("line")
    }
  }
  // Redacted first: error and status messages can carry provider URLs and keys.
  return (event) => Effect.sync(() => render(cleanEvent(event)))
}

function statusText(event: Extract<RenderEvent, { type: "status" }>) {
  if (event.phase === "retry")
    return `retry ${event.attempt ?? "?"}${event.wait_ms !== undefined ? ` in ${duration(event.wait_ms)}` : ""} · ${event.message}`
  return event.message
}
