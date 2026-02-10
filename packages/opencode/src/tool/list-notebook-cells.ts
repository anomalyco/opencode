import z from "zod"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import {
  formatCellInfo,
  normalizeSource,
  DEFAULT_LIST_PREVIEW_LENGTH,
  type Notebook
} from "../notebook"
import { loadNotebook, getDisplayPath } from "./notebook-utils"

const DESCRIPTION = `
List all cells in a Jupyter notebook (.ipynb) file.

This tool provides a quick overview of all cells with their indices,
types, and content previews. Useful for navigating large notebooks.

Parameters:
- filePath: Path to the .ipynb file
- cellType: (optional) Filter by cell type (code, markdown, raw)
- maxPreviewLength: Maximum length of content preview (default 80)

Output shows:
- Cell index (for use with edit/delete operations)
- Cell type
- Content preview
- Execution count (for code cells)
`.trim()

// Display constants
const SEPARATOR_LENGTH = 80
const SEPARATOR_CHAR = "─"

export const ListNotebookCellsTool = Tool.define("list_notebook_cells", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().min(1, "File path cannot be empty")
      .describe("The absolute path to the .ipynb file"),
    cellType: z.enum(["code", "markdown", "raw"]).optional()
      .describe("Filter by cell type (optional)"),
    maxPreviewLength: z.number().int().min(1).optional().default(DEFAULT_LIST_PREVIEW_LENGTH)
      .describe("Maximum length of content preview"),
  }),
  async execute(params, ctx) {
    const { notebook, filePath } = await loadNotebook(params, ctx)

    const displayPath = getDisplayPath(filePath)

    // Filter cells if requested
    const cells = filterCells(notebook, params.cellType)

    // Build output
    const output = buildListOutput(
      displayPath,
      notebook,
      cells,
      params.cellType,
      params.maxPreviewLength
    )

    FileTime.read(ctx.sessionID, filePath)

    return {
      metadata: {
        cellCount: cells.length,
        filteredBy: params.cellType,
        totalCells: notebook.cells.length
      },
      title: displayPath,
      output
    }
  }
})

function filterCells(
  notebook: Notebook,
  cellType?: "code" | "markdown" | "raw"
): Notebook["cells"] {
  if (!cellType) {
    return notebook.cells
  }
  return notebook.cells.filter(c => c.cell_type === cellType)
}

function buildListOutput(
  displayPath: string,
  notebook: Notebook,
  cells: Notebook["cells"],
  cellTypeFilter: string | undefined,
  maxPreviewLength: number
): string {
  const parts: string[] = []

  // Header
  parts.push(`📓 ${displayPath}`)
  parts.push(`${SEPARATOR_CHAR.repeat(SEPARATOR_LENGTH)}\n`)

  // Filter info
  if (cellTypeFilter) {
    parts.push(`Showing ${cellTypeFilter.toUpperCase()} cells only`)
  }

  parts.push(`Total cells: ${cells.length} / ${notebook.cells.length}\n`)

  if (cells.length === 0) {
    parts.push("No cells found")
    if (cellTypeFilter) {
      parts.push(` (filtering by ${cellTypeFilter})`)
    }
    parts.push("")
  } else {
    for (const cell of cells) {
      // Find actual index in notebook
      const actualIndex = notebook.cells.indexOf(cell)
      parts.push(formatCellInfo(cell, actualIndex, maxPreviewLength))

      // Add content preview
      const source = normalizeSource(cell.source)
      if (source.trim()) {
        const lines = source.split("\n")
        const firstLine = lines[0]?.trim() ?? ""
        const truncated = firstLine.length > maxPreviewLength

        parts.push(`  ${firstLine.slice(0, maxPreviewLength)}${truncated ? "..." : ""}`)

        // Show line count if multiline
        if (lines.length > 1) {
          parts.push(`  (${lines.length} lines total)`)
        }
      }

      parts.push("")
    }
  }

  return parts.join("\n")
}
