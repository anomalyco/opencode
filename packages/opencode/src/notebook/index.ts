/**
 * Jupyter Notebook (.ipynb) utility functions
 */

// Types
export type CellType = "code" | "markdown" | "raw"

export type CellOutput =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string | string[] }
  | { output_type: "execute_result"; execution_count: number; data: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { output_type: "display_data"; data: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] }

export interface NotebookCell {
  cell_type: CellType
  metadata: Record<string, unknown>
  source: string | string[]
  execution_count?: number | null
  outputs?: CellOutput[]
}

export interface NotebookMetadata {
  language_info?: { name: string; [key: string]: unknown }
  kernelspec?: { name: string; display_name: string; [key: string]: unknown }
  [key: string]: unknown
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

// Constants
export const DEFAULT_PREVIEW_LENGTH = 50
export const DEFAULT_MAX_PREVIEW_LENGTH = 200
export const DEFAULT_LIST_PREVIEW_LENGTH = 80

/**
 * Validate notebook structure (type guard)
 */
function isValidNotebookData(data: unknown): data is Notebook {
  if (typeof data !== "object" || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    Array.isArray(obj.cells) &&
    typeof obj.nbformat === "number" &&
    obj.nbformat === 4 &&
    typeof obj.metadata === "object" &&
    obj.metadata !== null
  )
}

/**
 * Parse notebook JSON
 */
export function parseNotebook(content: string): NotebookParseResult {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (!isValidNotebookData(data)) {
    return { success: false, error: "Invalid notebook format (must be nbformat 4.x)" }
  }

  return { success: true, notebook: data }
}

/**
 * Check if content is a valid notebook
 */
export function isValidNotebook(content: string): boolean {
  return parseNotebook(content).success
}

/**
 * Stringify notebook to JSON
 */
export function stringifyNotebook(notebook: Notebook): string {
  return JSON.stringify(notebook, null, 2)
}

/**
 * Normalize source to string
 */
export function normalizeSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source
}

/**
 * Convert source to array format (Jupyter standard)
 */
export function sourceToArray(source: string | string[]): string[] {
  if (Array.isArray(source)) return source
  return source === "" ? [""] : source.split("\n")
}

/**
 * Get cell at index, returns null if out of bounds
 */
export function getCell(notebook: Notebook, index: number): NotebookCell | null {
  return index >= 0 && index < notebook.cells.length ? notebook.cells[index] : null
}

/**
 * Add a new cell at position (or end if not specified)
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
  const index = position ?? cells.length

  if (index < 0 || index > cells.length) {
    throw new Error(`Position ${index} out of bounds (valid: 0-${cells.length})`)
  }

  cells.splice(index, 0, newCell)

  return { ...notebook, cells }
}

/**
 * Edit cell at index
 */
export function editCell(notebook: Notebook, index: number, source: string): Notebook {
  if (index < 0 || index >= notebook.cells.length) {
    throw new Error(`Cell index ${index} out of bounds (0-${notebook.cells.length - 1})`)
  }

  const cells = [...notebook.cells]
  cells[index] = { ...cells[index], source: sourceToArray(source) }

  return { ...notebook, cells }
}

/**
 * Delete cell at index
 */
export function deleteCell(notebook: Notebook, index: number): Notebook {
  if (index < 0 || index >= notebook.cells.length) {
    throw new Error(`Cell index ${index} out of bounds (0-${notebook.cells.length - 1})`)
  }

  return {
    ...notebook,
    cells: notebook.cells.filter((_, i) => i !== index)
  }
}

/**
 * Format cell info for display
 */
export function formatCellInfo(
  cell: NotebookCell,
  index: number,
  previewLength = DEFAULT_PREVIEW_LENGTH
): string {
  const source = normalizeSource(cell.source)
  const firstLine = source.split("\n")[0]?.trim() ?? ""
  const preview = firstLine.slice(0, previewLength)
  const suffix = firstLine.length > previewLength ? "..." : ""

  let info = `[${index}] ${cell.cell_type.toUpperCase()}`

  if (cell.cell_type === "code") {
    info += ` [exec: ${cell.execution_count ?? "not run"}]`
  }

  if (preview) {
    info += `: ${preview}${suffix}`
  }

  return info
}

/**
 * Get notebook summary
 */
export function getNotebookSummary(notebook: Notebook): string {
  const code = notebook.cells.filter(c => c.cell_type === "code").length
  const markdown = notebook.cells.filter(c => c.cell_type === "markdown").length
  const raw = notebook.cells.filter(c => c.cell_type === "raw").length
  const language = notebook.metadata.language_info?.name ?? "unknown"

  return [
    `Notebook (${notebook.nbformat}.${notebook.nbformat_minor})`,
    `Language: ${language}`,
    `Total cells: ${notebook.cells.length}`,
    `  • Code: ${code}`,
    `  • Markdown: ${markdown}`,
    `  • Raw: ${raw}`
  ].join("\n")
}
