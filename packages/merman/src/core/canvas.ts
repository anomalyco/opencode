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

const MAX_DIAGRAM_CELLS = 250_000

export class DiagramCanvasSizeError extends Error {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const invalid = !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0
    super(
      invalid
        ? `Diagram canvas dimensions must be non-negative safe integers, received ${width}x${height}`
        : `Diagram canvas ${width}x${height} exceeds the ${MAX_DIAGRAM_CELLS.toLocaleString()} cell limit`,
    )
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
  private readonly cells: Array<Array<DiagramCanvasCell<Style, Metadata>>>
  private readonly measure: (text: string) => number
  private readonly mergeCell?: DiagramCanvasOptions<Style, Metadata>["mergeCell"]
  private readonly rowEnds: Uint32Array

  constructor(
    readonly width: number,
    readonly height: number,
    options: DiagramCanvasOptions<Style, Metadata> = {},
  ) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0) {
      throw new DiagramCanvasSizeError(width, height)
    }
    if (width * height > MAX_DIAGRAM_CELLS) throw new DiagramCanvasSizeError(width, height)
    this.measure = options.measure ?? stringWidth
    this.mergeCell = options.mergeCell
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => createEmptyCell()))
    this.rowEnds = new Uint32Array(height)
  }

  get rows(): ReadonlyArray<ReadonlyArray<Readonly<DiagramCanvasCell<Style, Metadata>>>> {
    return this.cells
  }

  private rowText(row: Array<DiagramCanvasCell<Style, Metadata>>, rowEnd: number): string {
    return row
      .slice(0, rowEnd)
      .map((cell) => cell.char)
      .join("")
  }

  private textRowRange(trimTop: boolean, trimBottom: boolean): { start: number; end: number } {
    let start = 0
    let end = this.cells.length
    if (trimTop) while (start < end && this.rowEnds[start] === 0) start += 1
    if (trimBottom) while (end > start && this.rowEnds[end - 1] === 0) end -= 1
    return { start, end }
  }

  setCell(x: number, y: number, char: string, style?: Style, metadata?: Partial<Metadata>): void {
    this.writeCell(x, y, char, style, metadata, true)
  }

  replaceCell(x: number, y: number, char: string, style?: Style, metadata?: Partial<Metadata>): void {
    this.writeCell(x, y, char, style, metadata, false)
  }

  private writeCell(
    x: number,
    y: number,
    char: string,
    style: Style | undefined,
    metadata: Partial<Metadata> | undefined,
    merge: boolean,
  ): void {
    if (y < 0 || y >= this.cells.length || x < 0 || x >= this.cells[y]!.length) return
    const incoming = { char, style, ...metadata } as DiagramCanvasCell<Style, Metadata>
    const cell = merge ? (this.mergeCell?.(this.cells[y]![x]!, incoming) ?? incoming) : incoming
    this.cells[y]![x] = cell
    if (cell.char !== " ") {
      this.rowEnds[y] = Math.max(this.rowEnds[y]!, x + 1)
    } else if (this.rowEnds[y] === x + 1) {
      let end = x
      while (end > 0 && this.cells[y]![end - 1]?.char === " ") end -= 1
      this.rowEnds[y] = end
    }
  }

  getCell(x: number, y: number): Readonly<DiagramCanvasCell<Style, Metadata>> | undefined {
    return this.cells[y]?.[x]
  }

  setText(x: number, y: number, text: string, style?: Style, metadata?: DiagramCanvasTextMetadata<Metadata>): void {
    const metadataAt = (cellX: number) => (typeof metadata === "function" ? metadata(cellX, y) : metadata)
    if (this.measure === stringWidth && /^[\x20-\x7e]*$/.test(text)) {
      for (let index = 0; index < text.length; index++) {
        this.setCell(x + index, y, text[index]!, style, metadataAt(x + index))
      }
      return
    }

    let offset = 0
    for (const grapheme of diagramTextGraphemes(text)) {
      const width = Math.max(1, this.measure(grapheme))
      if (x + offset < 0 || x + offset + width > this.width) {
        offset += width
        continue
      }
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
      lines.push(this.rowText(this.cells[rowIndex]!, this.rowEnds[rowIndex]!))
    }
    return lines.join("\n")
  }

  getTextSize(options: DiagramCanvasTextOptions = {}): DiagramCanvasTextSize {
    const rows = this.textRowRange(options.trimTop ?? false, options.trimBottom ?? false)
    let width = 0
    for (let rowIndex = rows.start; rowIndex < rows.end; rowIndex++) {
      const row = this.cells[rowIndex]!
      const rowEnd = this.rowEnds[rowIndex]!
      if (rowEnd > 0) width = Math.max(width, this.measure(this.rowText(row, rowEnd)))
    }
    return { width, height: rows.end - rows.start }
  }

  getTextHeight(options: DiagramCanvasTextOptions = {}): number {
    const rows = this.textRowRange(options.trimTop ?? false, options.trimBottom ?? false)
    return rows.end - rows.start
  }

  forEachRun(
    onRun: (run: DiagramCanvasRun<Style, Metadata>) => void,
    onLineEnd: () => void,
    options: DiagramCanvasRunOptions<Style, Metadata> = {},
  ): void {
    const key = options.key
    const rows = this.textRowRange(options.trimTop ?? false, options.trimBottom ?? false)

    for (let rowIndex = rows.start; rowIndex < rows.end; rowIndex++) {
      const row = this.cells[rowIndex]!
      let rowEnd = this.rowEnds[rowIndex]!
      while (rowEnd < row.length && row[rowEnd]?.style !== undefined) rowEnd += 1

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
