// Terminal buffer for managing character grid state
import type { TerminalCell, TerminalDimensions } from "./types"
import { Colors } from "./types"

export class TerminalBuffer {
  private grid: TerminalCell[][]
  private dims: TerminalDimensions

  constructor(cols: number, rows: number) {
    this.dims = { cols, rows }
    this.grid = this.createEmptyGrid()
  }

  private createEmptyGrid(): TerminalCell[][] {
    return Array.from({ length: this.dims.rows }, () =>
      Array.from({ length: this.dims.cols }, () => this.createEmptyCell()),
    )
  }

  private createEmptyCell(): TerminalCell {
    return {
      char: " ",
      fg: Colors.TEXT_MAIN,
      bg: Colors.BG_MAIN,
      bold: false,
      italic: false,
      underline: false,
    }
  }

  // Write a single character at position
  writeChar(col: number, row: number, cell: Partial<TerminalCell>) {
    if (row < 0 || row >= this.dims.rows || col < 0 || col >= this.dims.cols) return

    const current = this.grid[row][col]
    this.grid[row][col] = { ...current, ...cell }
  }

  // Write a string starting at position
  writeString(col: number, row: number, text: string, style?: Partial<Omit<TerminalCell, "char">>) {
    for (let i = 0; i < text.length; i++) {
      if (col + i >= this.dims.cols) break
      this.writeChar(col + i, row, {
        char: text[i],
        ...style,
      })
    }
  }

  // Fill a rectangular region with a character and style
  fillRect(startCol: number, startRow: number, width: number, height: number, cell: Partial<TerminalCell>) {
    for (let row = startRow; row < startRow + height; row++) {
      for (let col = startCol; col < startCol + width; col++) {
        this.writeChar(col, row, cell)
      }
    }
  }

  // Clear a rectangular region
  clearRect(startCol: number, startRow: number, width: number, height: number) {
    this.fillRect(startCol, startRow, width, height, this.createEmptyCell())
  }

  // Get cell at position
  getCell(col: number, row: number): TerminalCell | null {
    if (row < 0 || row >= this.dims.rows || col < 0 || col >= this.dims.cols) return null
    return this.grid[row][col]
  }

  // Get entire grid
  getGrid(): TerminalCell[][] {
    return this.grid
  }

  // Get dimensions
  getDimensions(): TerminalDimensions {
    return this.dims
  }

  // Clear entire buffer
  clear() {
    this.grid = this.createEmptyGrid()
  }

  // Resize buffer
  resize(cols: number, rows: number) {
    this.dims = { cols, rows }
    this.grid = this.createEmptyGrid()
  }
}
