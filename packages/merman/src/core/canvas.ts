import stringWidth from "string-width"
import { diagramTextGraphemes } from "./text.js"

export type DiagramCanvasCell<Style extends string, Metadata extends object = object> = {
  char: string
  style?: Style
} & Partial<Metadata>

export interface DiagramCanvasRun<Style extends string, Metadata extends object = object> {
  text: string
  style: Style | undefined
  cell: DiagramCanvasCell<Style, Metadata>
}

export interface DiagramCanvasOptions<Style extends string, Metadata extends object = object> {
  measure?: (text: string) => number
  mergeCell?: (
    existing: DiagramCanvasCell<Style, Metadata>,
    incoming: DiagramCanvasCell<Style, Metadata>,
  ) => DiagramCanvasCell<Style, Metadata>
}

export interface DiagramCanvasTextOptions {
  trimTop?: boolean
  trimBottom?: boolean
}

export interface DiagramCanvasTextSize {
  width: number
  height: number
}

export type DiagramCanvasTextMetadata<Metadata extends object> =
  | Partial<Metadata>
  | ((x: number, y: number) => Partial<Metadata>)

export interface DiagramCanvasRunOptions<Style extends string, Metadata extends object = object> {
  key?: (cell: DiagramCanvasCell<Style, Metadata>) => readonly unknown[]
  trimTop?: boolean
  trimBottom?: boolean
}

const MAX_DIAGRAM_CELLS = 1_000_000

export class DiagramCanvasSizeError extends Error {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super(`Diagram canvas ${width}x${height} exceeds the ${MAX_DIAGRAM_CELLS.toLocaleString()} cell limit`)
    this.name = "DiagramCanvasSizeError"
  }
}

function createEmptyCell<Style extends string, Metadata extends object>(): DiagramCanvasCell<Style, Metadata> {
  return { char: " " } as DiagramCanvasCell<Style, Metadata>
}

function sameKey(left: readonly unknown[] | undefined, right: readonly unknown[]): boolean {
  return Boolean(left && left.length === right.length && left.every((value, index) => Object.is(value, right[index])))
}

export class DiagramCanvas<Style extends string, Metadata extends object = object> {
  readonly rows: Array<Array<DiagramCanvasCell<Style, Metadata>>>

  private readonly measure: (text: string) => number
  private readonly mergeCell?: DiagramCanvasOptions<Style, Metadata>["mergeCell"]

  constructor(
    readonly width: number,
    readonly height: number,
    options: DiagramCanvasOptions<Style, Metadata> = {},
  ) {
    if (width * height > MAX_DIAGRAM_CELLS) throw new DiagramCanvasSizeError(width, height)
    this.measure = options.measure ?? stringWidth
    this.mergeCell = options.mergeCell
    this.rows = Array.from({ length: height }, () => Array.from({ length: width }, () => createEmptyCell()))
  }

  private rowTextEnd(row: Array<DiagramCanvasCell<Style, Metadata>>): number {
    let rowEnd = row.length
    while (rowEnd > 0 && row[rowEnd - 1]?.char === " ") rowEnd -= 1
    return rowEnd
  }

  private rowText(row: Array<DiagramCanvasCell<Style, Metadata>>, rowEnd = this.rowTextEnd(row)): string {
    return row
      .slice(0, rowEnd)
      .map((cell) => cell.char)
      .join("")
  }

  private textRowRange(trimTop: boolean, trimBottom: boolean): { start: number; end: number } {
    let start = 0
    let end = this.rows.length
    if (trimTop) while (start < end && this.rowTextEnd(this.rows[start]!) === 0) start += 1
    if (trimBottom) while (end > start && this.rowTextEnd(this.rows[end - 1]!) === 0) end -= 1
    return { start, end }
  }

  setCell(x: number, y: number, char: string, style?: Style, metadata?: Partial<Metadata>): void {
    if (y < 0 || y >= this.rows.length || x < 0 || x >= this.rows[y]!.length) return

    const incoming = { char, style, ...metadata } as DiagramCanvasCell<Style, Metadata>
    this.rows[y]![x] = this.mergeCell?.(this.rows[y]![x]!, incoming) ?? incoming
  }

  getCell(x: number, y: number): DiagramCanvasCell<Style, Metadata> | undefined {
    return this.rows[y]?.[x]
  }

  setText(x: number, y: number, text: string, style?: Style, metadata?: DiagramCanvasTextMetadata<Metadata>): void {
    let offset = 0
    for (const grapheme of diagramTextGraphemes(text)) {
      const width = Math.max(1, this.measure(grapheme))
      const metadataAt = (cellX: number) => (typeof metadata === "function" ? metadata(cellX, y) : metadata)
      this.setCell(x + offset, y, grapheme, style, metadataAt(x + offset))
      for (let continuation = 1; continuation < width; continuation++) {
        this.setCell(x + offset + continuation, y, "", style, metadataAt(x + offset + continuation))
      }
      offset += width
    }
  }

  toString(options: DiagramCanvasTextOptions = {}): string {
    const lines: string[] = []
    const rows = this.textRowRange(options.trimTop ?? false, options.trimBottom ?? false)
    for (let rowIndex = rows.start; rowIndex < rows.end; rowIndex++) {
      lines.push(this.rowText(this.rows[rowIndex]!))
    }
    return lines.join("\n")
  }

  getTextSize(options: DiagramCanvasTextOptions = {}): DiagramCanvasTextSize {
    const rows = this.textRowRange(options.trimTop ?? false, options.trimBottom ?? false)
    let width = 0
    for (let rowIndex = rows.start; rowIndex < rows.end; rowIndex++) {
      const row = this.rows[rowIndex]!
      const rowEnd = this.rowTextEnd(row)
      if (rowEnd > 0) width = Math.max(width, this.measure(this.rowText(row, rowEnd)))
    }
    return { width, height: rows.end - rows.start }
  }

  forEachRun(
    onRun: (run: DiagramCanvasRun<Style, Metadata>) => void,
    onLineEnd: () => void,
    options: DiagramCanvasRunOptions<Style, Metadata> = {},
  ): void {
    const key = options.key
    const rows = this.textRowRange(options.trimTop ?? false, options.trimBottom ?? false)

    for (let rowIndex = rows.start; rowIndex < rows.end; rowIndex++) {
      const row = this.rows[rowIndex]!
      const rowEnd = this.rowTextEnd(row)

      let currentCell: DiagramCanvasCell<Style, Metadata> | undefined
      let currentKey: readonly unknown[] | undefined
      let currentText = ""
      const flush = () => {
        if (!currentText || !currentCell) return
        onRun({ text: currentText, style: currentCell.style, cell: currentCell })
        currentText = ""
      }

      for (let x = 0; x < rowEnd; x++) {
        const cell = row[x]!
        const nextKey = key?.(cell)
        const sameRun = currentCell && (key ? sameKey(currentKey, nextKey!) : currentCell.style === cell.style)
        if (!sameRun) {
          flush()
          currentCell = cell
          currentKey = nextKey
        }
        currentText += cell.char
      }

      flush()
      if (rowIndex < rows.end - 1) onLineEnd()
    }
  }
}
