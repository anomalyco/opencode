/**
 * Jupyter Notebook (.ipynb) utility functions for OpenCode
 * Handles parsing, validating, and manipulating Jupyter notebook JSON structure
 */

export type CellType = "code" | "markdown" | "raw"

export interface NotebookCell {
  cell_type: CellType
  metadata: Record<string, any>
  source: string | string[]
  execution_count?: number | null
  outputs?: Array<{
    output_type: string
    [key: string]: any
  }>
}

export interface NotebookMetadata {
  language_info?: {
    name: string
    [key: string]: any
  }
  kernelspec?: {
    name: string
    display_name: string
    [key: string]: any
  }
  [key: string]: any
}

export interface Notebook {
  cells: NotebookCell[]
  metadata: NotebookMetadata
  nbformat: number
  nbformat_minor: number
}

export interface NotebookParseResult {
  success: boolean
  notebook?: Notebook
  error?: string
}

/**
 * Validates if a file is a valid Jupyter notebook
 */
export function isValidNotebook(content: string): boolean {
  try {
    const data = JSON.parse(content)
    return (
      typeof data === "object" &&
      data !== null &&
      "cells" in data &&
      Array.isArray(data.cells) &&
      "nbformat" in data &&
      "metadata" in data
    )
  } catch {
    return false
  }
}

/**
 * Parse notebook JSON content
 */
export function parseNotebook(content: string): NotebookParseResult {
  try {
    const data = JSON.parse(content)
    
    if (!isValidNotebook(content)) {
      return {
        success: false,
        error: "Invalid notebook format: missing required fields (cells, nbformat, metadata)"
      }
    }

    return {
      success: true,
      notebook: data as Notebook
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse notebook JSON: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Convert notebook back to JSON string
 */
export function stringifyNotebook(notebook: Notebook): string {
  return JSON.stringify(notebook, null, 2)
}

/**
 * Normalize cell source to string (handles both string and string[] formats)
 */
export function normalizeSource(source: string | string[]): string {
  if (Array.isArray(source)) {
    return source.join("")
  }
  return source
}

/**
 * Convert source to array format (preferred format)
 */
export function sourceToArray(source: string | string[]): string[] {
  if (Array.isArray(source)) {
    return source
  }
  return source.split(/(?<=\n)/)
}

/**
 * Get cell by index
 */
export function getCell(notebook: Notebook, index: number): NotebookCell | null {
  if (index < 0 || index >= notebook.cells.length) {
    return null
  }
  return notebook.cells[index]
}

/**
 * Add a new cell at the specified position
 */
export function addCell(
  notebook: Notebook,
  cellType: CellType,
  source: string,
  position?: number
): Notebook {
  const newCell: NotebookCell = {
    cell_type: cellType,
    metadata: {},
    source: sourceToArray(source)
  }

  if (cellType === "code") {
    newCell.execution_count = null
    newCell.outputs = []
  }

  const cells = [...notebook.cells]
  if (position === undefined || position === cells.length) {
    cells.push(newCell)
  } else {
    cells.splice(position, 0, newCell)
  }

  return {
    ...notebook,
    cells
  }
}

/**
 * Edit cell at specified index
 */
export function editCell(
  notebook: Notebook,
  index: number,
  source: string
): Notebook {
  if (index < 0 || index >= notebook.cells.length) {
    throw new Error(`Cell index ${index} out of bounds`)
  }

  const cells = [...notebook.cells]
  cells[index] = {
    ...cells[index],
    source: sourceToArray(source)
  }

  return {
    ...notebook,
    cells
  }
}

/**
 * Delete cell at specified index
 */
export function deleteCell(notebook: Notebook, index: number): Notebook {
  if (index < 0 || index >= notebook.cells.length) {
    throw new Error(`Cell index ${index} out of bounds`)
  }

  const cells = notebook.cells.filter((_, i) => i !== index)

  return {
    ...notebook,
    cells
  }
}

/**
 * Format cell information for display
 */
export function formatCellInfo(cell: NotebookCell, index: number): string {
  const source = normalizeSource(cell.source)
  const preview = source.split("\n")[0].trim().slice(0, 50)
  const cellType = cell.cell_type.toUpperCase()
  
  let info = `[${index}] ${cellType}`
  
  if (cell.cell_type === "code") {
    info += ` [exec: ${cell.execution_count ?? "not run"}]`
  }
  
  if (preview) {
    info += `: ${preview}${source.length > 50 ? "..." : ""}`
  }
  
  return info
}

/**
 * Get notebook summary
 */
export function getNotebookSummary(notebook: Notebook): string {
  const codeCells = notebook.cells.filter(c => c.cell_type === "code").length
  const markdownCells = notebook.cells.filter(c => c.cell_type === "markdown").length
  const rawCells = notebook.cells.filter(c => c.cell_type === "raw").length
  
  const language = notebook.metadata.language_info?.name || "unknown"
  
  return `Notebook (${notebook.nbformat}.${notebook.nbformat_minor})` +
         `\nLanguage: ${language}` +
         `\nTotal cells: ${notebook.cells.length}` +
         `  • Code: ${codeCells}` +
         `  • Markdown: ${markdownCells}` +
         `  • Raw: ${rawCells}`
}
