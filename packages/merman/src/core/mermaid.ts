export interface NumberedMermaidLine {
  readonly lineNumber: number
  readonly text: string
}

export function* numberedMermaidLines(content: string): Generator<NumberedMermaidLine> {
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    yield { lineNumber: index + 1, text: lines[index]!.trim() }
  }
}

export function* meaningfulNumberedMermaidLines(content: string): Generator<NumberedMermaidLine> {
  for (const line of numberedMermaidLines(content)) {
    if (line.text && !line.text.startsWith("%%")) yield line
  }
}

export function firstMeaningfulMermaidLine(content: string): string | undefined {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line && !line.startsWith("%%")) return line
  }
  return undefined
}

export function stripMermaidQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
