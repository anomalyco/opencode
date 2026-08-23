import { firstMeaningfulMermaidLine, meaningfulNumberedMermaidLines, stripMermaidQuotes } from "../core/mermaid.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import type { TimelineDiagram, TimelineDirection, TimelineEntry, TimelinePeriod, TimelineSection } from "./types.js"

const HEADER_RE = /^timeline(?:\s+(TD|LR))?$/i
const TITLE_RE = /^title(?:\s+(.+))?$/i
const SECTION_RE = /^section(?:\s+(.+))?$/i
const ACCESSIBILITY_RE = /^acc(?:Title|Descr)(?::|\s|$)/i

export function isMermaidTimelineDiagram(content: string): boolean {
  return HEADER_RE.test(firstMeaningfulMermaidLine(content) ?? "")
}

export function parseMermaidTimelineDiagram(content: string): TimelineDiagram {
  const sections: TimelineSection[] = []
  const periods: TimelinePeriod[] = []
  const entries: TimelineEntry[] = []
  let direction: TimelineDirection = "LR"
  let title: string | undefined
  let currentPeriod: TimelinePeriod | undefined
  let inAccessibilityDescription = false

  for (const source of meaningfulNumberedMermaidLines(content)) {
    const line = stripTimelineComment(source.text)
    if (inAccessibilityDescription) {
      if (line === "}") inAccessibilityDescription = false
      continue
    }
    if (/^accDescr\s*\{$/i.test(line)) {
      inAccessibilityDescription = true
      continue
    }
    if (!line || line.startsWith("#") || ACCESSIBILITY_RE.test(line)) continue
    const header = line.match(HEADER_RE)
    if (header) {
      direction = (header[1]?.toUpperCase() as TimelineDirection | undefined) ?? "LR"
      continue
    }

    const titleMatch = line.match(TITLE_RE)
    if (titleMatch) {
      if (!titleMatch[1]) throw syntaxError(source.lineNumber, line, "Timeline title cannot be empty")
      title = stripMermaidQuotes(titleMatch[1])
      continue
    }

    const sectionMatch = line.match(SECTION_RE)
    if (sectionMatch) {
      if (!sectionMatch[1]) throw syntaxError(source.lineNumber, line, "Timeline section cannot be empty")
      const section = { label: stripMermaidQuotes(sectionMatch[1]) }
      sections.push(section)
      entries.push({ type: "section", section })
      currentPeriod = undefined
      continue
    }

    if (line.startsWith(":")) {
      if (!currentPeriod) {
        throw syntaxError(source.lineNumber, line, "Timeline continuation requires a preceding period")
      }
      currentPeriod.events.push(...parseEvents(line.slice(1), source.lineNumber, line))
      continue
    }

    const fields = splitEventFields(line)
    const periodLabel = stripMermaidQuotes(fields.shift()!)
    if (!periodLabel) throw syntaxError(source.lineNumber, line, "Timeline period cannot be empty")
    const period = {
      period: periodLabel,
      events: fields.length === 0 ? [] : parseEventFields(fields, source.lineNumber, line),
    }
    periods.push(period)
    entries.push({ type: "period", period })
    currentPeriod = period
  }

  return { direction, ...(title === undefined ? {} : { title }), sections, periods, entries }
}

function parseEvents(value: string, lineNumber: number, sourceLine: string): string[] {
  return parseEventFields(splitEventFields(value), lineNumber, sourceLine)
}

function parseEventFields(fields: string[], lineNumber: number, sourceLine: string): string[] {
  const events = fields.map(stripMermaidQuotes)
  if (events.length === 0 || events.some((event) => event.length === 0)) {
    throw syntaxError(lineNumber, sourceLine, "Timeline event cannot be empty")
  }
  return events
}

function splitEventFields(value: string): string[] {
  const fields: string[] = []
  let quote: '"' | "'" | undefined
  let start = 0
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '"' || char === "'") {
      if (quote === char) quote = undefined
      else if (quote === undefined && value.slice(start, index).trim() === "") quote = char
      continue
    }
    const next = value[index + 1]
    if (char !== ":" || quote !== undefined || (next !== undefined && !/\s/.test(next))) continue
    fields.push(value.slice(start, index))
    start = index + 1
  }
  fields.push(value.slice(start))
  return fields
}

function stripTimelineComment(value: string): string {
  const comment = value.indexOf("%%")
  return (comment < 0 ? value : value.slice(0, comment)).trim()
}

function syntaxError(lineNumber: number, sourceLine: string, reason?: string): MermaidSyntaxError {
  return new MermaidSyntaxError("timeline", lineNumber, sourceLine, reason)
}
