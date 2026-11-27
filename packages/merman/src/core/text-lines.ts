export interface DiagramTextRun {
  text: string
  italic: boolean
  bold: boolean
}

export interface DiagramTextLine {
  text: string
  runs: DiagramTextRun[]
}

export function parseDiagramTextLines(value: string): DiagramTextLine[] {
  return value.split(/<br\s*\/?>/i).map((line) => {
    const runs: DiagramTextRun[] = []
    const source = line.trim()
    const tag = /<(\/?)(i|em|b|strong)\s*>/gi
    let italic = false
    let bold = false
    let offset = 0

    for (const match of source.matchAll(tag)) {
      if (match.index > offset) runs.push({ text: source.slice(offset, match.index), italic, bold })
      const open = match[1] === ""
      if (/^(?:i|em)$/i.test(match[2]!)) italic = open
      if (/^(?:b|strong)$/i.test(match[2]!)) bold = open
      offset = match.index + match[0].length
    }
    if (offset < source.length) runs.push({ text: source.slice(offset), italic, bold })

    return { text: runs.map((run) => run.text).join(""), runs }
  })
}

export function splitDiagramLines(value: string): string[] {
  return parseDiagramTextLines(value).map((line) => line.text)
}
