import { firstMeaningfulMermaidLine, meaningfulNumberedMermaidLines, stripMermaidQuotes } from "../core/mermaid.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import type { GanttDiagram, GanttEntry, GanttSection, GanttTask, GanttTaskState } from "./types.js"

const HEADER_RE = /^gantt$/i
const DIRECTIVE_RE = /^(title|dateFormat|axisFormat|tickInterval|excludes|todayMarker)\s+(.+)$/i
const SECTION_RE = /^section(?:\s+(.+))?$/i
const ACCESSIBILITY_RE = /^acc(?:Title|Descr)(?::|\s|$)/i
const TASK_STATES = new Set(["active", "done", "crit", "milestone", "vert"])

export function isMermaidGanttDiagram(content: string): boolean {
  return HEADER_RE.test(firstMeaningfulMermaidLine(content) ?? "")
}

export function parseMermaidGanttDiagram(content: string): GanttDiagram {
  const tasks: GanttTask[] = []
  const entries: GanttEntry[] = []
  const tasksById = new Map<string, GanttTask>()
  let title: string | undefined
  let dateFormat = "YYYY-MM-DD"
  let axisFormat = "%Y-%m-%d"
  let section: GanttSection | undefined
  let headerSeen = false
  let inAccessibilityDescription = false

  for (const source of meaningfulNumberedMermaidLines(content)) {
    const line = stripComment(source.text)
    if (inAccessibilityDescription) {
      if (line === "}") inAccessibilityDescription = false
      continue
    }
    if (/^accDescr\s*\{$/i.test(line)) {
      inAccessibilityDescription = true
      continue
    }
    if (ACCESSIBILITY_RE.test(line)) continue
    if (!line) continue
    if (HEADER_RE.test(line)) {
      if (headerSeen) throw syntaxError(source.lineNumber, line, "Gantt header can only appear once")
      headerSeen = true
      continue
    }
    if (!headerSeen) throw syntaxError(source.lineNumber, line, "Gantt header is required")

    const sectionMatch = line.match(SECTION_RE)
    if (sectionMatch) {
      if (!sectionMatch[1]) throw syntaxError(source.lineNumber, line, "Gantt section cannot be empty")
      section = { label: stripMermaidQuotes(sectionMatch[1]) }
      entries.push({ type: "section", section })
      continue
    }

    const directive = line.match(DIRECTIVE_RE)
    if (directive) {
      const name = directive[1]!.toLowerCase()
      const value = directive[2]!.trim()
      if (name === "title") title = stripMermaidQuotes(value)
      if (name === "dateformat") dateFormat = value
      if (name === "axisformat") axisFormat = value
      if (!["title", "dateformat", "axisformat"].includes(name)) {
        throw syntaxError(source.lineNumber, line, `${directive[1]} is not supported`)
      }
      continue
    }

    const separator = line.indexOf(":")
    if (separator < 1) throw syntaxError(source.lineNumber, line)
    const label = stripMermaidQuotes(line.slice(0, separator))
    const fields = line
      .slice(separator + 1)
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean)
    const flags = new Set<string>()
    while (fields[0] && TASK_STATES.has(fields[0].toLowerCase())) flags.add(fields.shift()!.toLowerCase())
    if (fields.length < 2 || fields.length > 3) {
      throw syntaxError(source.lineNumber, line, "Gantt tasks require a start and end or duration")
    }
    const id = fields.length === 3 ? fields.shift() : undefined
    if (id && tasksById.has(id)) throw syntaxError(source.lineNumber, line, `Duplicate task id "${id}"`)
    const start = parseStart(fields[0]!, dateFormat, tasksById, source.lineNumber, line)
    const end = parseEnd(fields[1]!, start, dateFormat, source.lineNumber, line)
    if (end < start) throw syntaxError(source.lineNumber, line, "Gantt task cannot end before it starts")
    const task: GanttTask = {
      label,
      ...(id ? { id } : {}),
      ...(section ? { section } : {}),
      start,
      end,
      state: taskState(flags),
    }
    tasks.push(task)
    entries.push({ type: "task", task })
    if (id) tasksById.set(id, task)
  }

  if (!headerSeen) throw new MermaidSyntaxError("gantt", 1, "", "Gantt header is required")
  return { ...(title === undefined ? {} : { title }), dateFormat, axisFormat, tasks, entries }
}

function parseStart(
  value: string,
  format: string,
  tasksById: Map<string, GanttTask>,
  lineNumber: number,
  sourceLine: string,
): number {
  if (!/^after\s+/i.test(value)) return parseDate(value, format, lineNumber, sourceLine)
  const dependencies = value
    .replace(/^after\s+/i, "")
    .trim()
    .split(/\s+/)
  const tasks = dependencies.map((id) => tasksById.get(id))
  const missing = dependencies.find((_, index) => !tasks[index])
  if (missing) throw syntaxError(lineNumber, sourceLine, `Unknown Gantt task id "${missing}"`)
  return Math.max(...tasks.map((task) => task!.end))
}

function parseEnd(value: string, start: number, format: string, lineNumber: number, sourceLine: string): number {
  const duration = value.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i)
  if (!duration) return parseDate(value, format, lineNumber, sourceLine)
  const units = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
  return start + Number(duration[1]) * units[duration[2]!.toLowerCase() as keyof typeof units]
}

function parseDate(value: string, format: string, lineNumber: number, sourceLine: string): number {
  const numeric = Number(value)
  if (format === "s" && Number.isFinite(numeric)) return numeric * 1_000
  if (format === "X" && Number.isFinite(numeric)) return numeric * 1_000
  if (format === "x" && Number.isFinite(numeric)) return numeric

  const calendar = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (calendar && ["YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DD HH:mm:ss"].includes(format)) {
    return Date.UTC(
      Number(calendar[1]),
      Number(calendar[2]) - 1,
      Number(calendar[3]),
      Number(calendar[4] ?? 0),
      Number(calendar[5] ?? 0),
      Number(calendar[6] ?? 0),
    )
  }
  throw syntaxError(lineNumber, sourceLine, `Unsupported date "${value}" for dateFormat ${format}`)
}

function taskState(flags: Set<string>): GanttTaskState {
  if (flags.has("milestone")) return "milestone"
  if (flags.has("crit")) return "critical"
  if (flags.has("done")) return "done"
  if (flags.has("active")) return "active"
  return "task"
}

function stripComment(value: string): string {
  const comment = value.indexOf("%%")
  return (comment < 0 ? value : value.slice(0, comment)).trim()
}

function syntaxError(lineNumber: number, sourceLine: string, reason?: string): MermaidSyntaxError {
  return new MermaidSyntaxError("gantt", lineNumber, sourceLine, reason)
}
