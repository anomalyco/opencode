/**
 * Terminal renderer for the VantaCode agent loop — Claude-Code-style UX.
 *
 * Turns LoopEvents into concise, human-readable, colored terminal output:
 *   - streaming assistant text
 *   - one-line tool-call display (not a JSON dump)
 *   - a live task list (pending / in-progress / complete)
 *   - a status line (provider/model, GPU/VRAM)
 *   - inline colored diffs on edits
 *   - a transcript accumulator + end-of-session files-touched summary
 *
 * Rendering is decoupled from IO via a RendererSink so it unit tests cleanly.
 */

import type { LoopEvent } from "./agent-loop.ts"

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RED = "\x1b[31m"
const BLUE = "\x1b[34m"

export type TaskState = "pending" | "in-progress" | "complete"

export interface TaskItem {
  readonly id: string
  readonly title: string
  state: TaskState
}

export interface StatusInfo {
  readonly provider: string
  readonly model: string
  readonly gpu?: string
  readonly vramMB?: number
  readonly permissionMode?: string
}

export interface RendererSink {
  write(line: string): void
}

const stderrSink: RendererSink = { write: (line) => process.stderr.write(line) }

/** Produce a short, readable one-line description of a tool call. */
export function toolCallLine(name: string, args: Record<string, unknown>): string {
  const lower = name.toLowerCase()
  const pick = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined)
  if (/bash|shell|exec|run|command/.test(lower)) {
    const cmd = pick("command") ?? pick("cmd") ?? ""
    return `Bash: ${truncate(cmd, 72)}`
  }
  if (/edit|write|patch|multiedit|create/.test(lower)) {
    const file = pick("file_path") ?? pick("path") ?? pick("filename") ?? ""
    return `${name}: ${truncate(file, 72)}`
  }
  if (/read|cat|view/.test(lower)) {
    const file = pick("file_path") ?? pick("path") ?? ""
    return `Read: ${truncate(file, 72)}`
  }
  if (/grep|search/.test(lower)) {
    const pattern = pick("pattern") ?? pick("query") ?? ""
    return `Search: ${truncate(pattern, 60)}`
  }
  if (/glob|list|ls/.test(lower)) {
    const p = pick("pattern") ?? pick("path") ?? ""
    return `List: ${truncate(p, 60)}`
  }
  // Fallback: name + compact args.
  const compact = truncate(JSON.stringify(args), 60)
  return `${name}: ${compact}`
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim()
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine
}

export function renderTaskList(tasks: ReadonlyArray<TaskItem>, color = true): string {
  const rows = tasks.map((t) => {
    const icon = t.state === "complete" ? "✔" : t.state === "in-progress" ? "▸" : "○"
    const body = `  ${icon} ${t.title}`
    if (!color) return body
    if (t.state === "complete") return `${GREEN}${body}${RESET}`
    if (t.state === "in-progress") return `${CYAN}${body}${RESET}`
    return `${DIM}${body}${RESET}`
  })
  return rows.join("\n")
}

export function renderStatusLine(status: StatusInfo, color = true): string {
  const parts = [`${status.provider}/${status.model}`]
  if (status.gpu) parts.push(status.vramMB ? `${status.gpu} ${Math.round(status.vramMB / 1024)}GB` : status.gpu)
  else parts.push("CPU")
  if (status.permissionMode) parts.push(status.permissionMode)
  const body = `[ ${parts.join(" · ")} ]`
  return color ? `${DIM}${body}${RESET}` : body
}

export function renderFilesSummary(files: ReadonlyArray<string>, color = true): string {
  if (files.length === 0) return color ? `${DIM}No files were changed.${RESET}` : "No files were changed."
  const header = color ? `${BOLD}Files changed (${files.length}):${RESET}` : `Files changed (${files.length}):`
  const rows = files.map((f) => (color ? `  ${GREEN}~${RESET} ${f}` : `  ~ ${f}`))
  return [header, ...rows].join("\n")
}

export class Renderer {
  private readonly sink: RendererSink
  private readonly color: boolean
  private transcript = ""
  private streamingLineOpen = false

  constructor(sink: RendererSink = stderrSink, color = true) {
    this.sink = sink
    this.color = color
  }

  private line(s: string): void {
    if (this.streamingLineOpen) {
      this.sink.write("\n")
      this.streamingLineOpen = false
    }
    this.sink.write(`${s}\n`)
  }

  get fullTranscript(): string {
    return this.transcript
  }

  status(info: StatusInfo): void {
    this.line(renderStatusLine(info, this.color))
  }

  tasks(items: ReadonlyArray<TaskItem>): void {
    this.line(renderTaskList(items, this.color))
  }

  /** Render an inline colored diff (from diff.renderDiff) as its own block. */
  diff(rendered: string): void {
    this.line(rendered)
  }

  handle(event: LoopEvent): void {
    switch (event.type) {
      case "turn-start":
        this.transcript += `\n--- turn ${event.turn} ---\n`
        break
      case "assistant-text":
        this.transcript += event.text
        if (event.streaming) {
          this.sink.write(event.text)
          this.streamingLineOpen = true
        } else {
          this.line(event.text)
        }
        break
      case "tool-call": {
        const label = toolCallLine(event.name, event.args)
        this.line(this.color ? `${CYAN}⚙ ${label}${RESET}` : `⚙ ${label}`)
        this.transcript += `\n[tool-call] ${label}\n`
        break
      }
      case "tool-result": {
        const icon = event.ok ? (this.color ? `${GREEN}✔${RESET}` : "✔") : this.color ? `${RED}✗${RESET}` : "✗"
        const preview = truncate(event.output, 100)
        this.line(`  ${icon} ${this.color ? DIM : ""}${preview}${this.color ? RESET : ""}`)
        this.transcript += `[tool-result:${event.ok ? "ok" : "err"}] ${preview}\n`
        break
      }
      case "tool-rejected":
        this.line(this.color ? `  ${YELLOW}⚠ rejected:${RESET} ${event.reason}` : `  ⚠ rejected: ${event.reason}`)
        this.transcript += `[tool-rejected:${event.name}] ${event.reason}\n`
        break
      case "permission-denied":
        this.line(this.color ? `  ${YELLOW}⨯ permission denied:${RESET} ${event.name}` : `  ⨯ permission denied: ${event.name}`)
        break
      case "hallucination":
        this.line(this.color ? `${RED}⚠ discarded hallucinated claim:${RESET} ${event.reason}` : `⚠ discarded hallucinated claim: ${event.reason}`)
        this.transcript += `[hallucination-guard] ${event.reason}\n`
        break
      case "warning":
        this.line(this.color ? `${YELLOW}⚠ ${event.message}${RESET}` : `⚠ ${event.message}`)
        break
      case "done":
        this.transcript += `\n[done: ${event.reason}]\n`
        break
    }
  }

  filesSummary(files: ReadonlyArray<string>): void {
    this.line(renderFilesSummary(files, this.color))
  }

  info(message: string): void {
    this.line(this.color ? `${BLUE}${message}${RESET}` : message)
  }
}
