import z from "zod"
import { Tool } from "./tool"
import {
  editCell,
  stringifyNotebook,
  getNotebookSummary,
  normalizeSource,
  type Notebook
} from "../notebook"
import {
  loadNotebook,
  getDisplayPath,
  calculateFileDiff,
  writeNotebook,
  truncatePreview
} from "./notebook-utils"

const DESCRIPTION = `
Edit a specific cell in a Jupyter notebook (.ipynb) file.

This tool allows you to modify the content of a specific cell while preserving:
- Cell metadata
- Cell type (code, markdown, raw)
- Execution counts
- Cell outputs (for code cells)
- All other cells in the notebook

Parameters:
- filePath: Path to the .ipynb file
- cellIndex: Zero-based index of the cell to edit (0 = first cell)
- newSource: New content for the cell

Use read_notebook first to see the cell indices and their content.
`.trim()

// Display constants
const PREVIEW_LENGTH = 100

export const EditNotebookCellTool = Tool.define("edit_notebook_cell", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().min(1, "File path cannot be empty")
      .describe("The absolute path to the .ipynb file"),
    cellIndex: z.number().int().min(0, "Cell index must be non-negative")
      .describe("Zero-based index of the cell to edit"),
    newSource: z.string()
      .describe("New content for the cell"),
  }),
  async execute(params, ctx) {
    const { notebook, content: contentOld, filePath } = await loadNotebook(params, ctx)

    // Validate cell index and get the cell
    if (params.cellIndex >= notebook.cells.length) {
      throw new Error(
        `Cell index ${params.cellIndex} out of bounds. ` +
        `Notebook has ${notebook.cells.length} cells (valid indices: 0-${notebook.cells.length - 1})`
      )
    }

    // Get the old cell info before editing
    const oldCell = notebook.cells[params.cellIndex]
    const oldSource = normalizeSource(oldCell.source)

    // Edit the cell (bounds check already done above)
    const updatedNotebook = editCell(notebook, params.cellIndex, params.newSource)
    const contentNew = stringifyNotebook(updatedNotebook)

    // Ask for permission before writing
    const displayPath = getDisplayPath(filePath)
    await ctx.ask({
      permission: "edit",
      patterns: [displayPath],
      always: ["*"],
      metadata: {
        filepath: filePath,
        cellIndex: params.cellIndex,
        cellType: oldCell.cell_type,
        oldPreview: truncatePreview(oldSource, PREVIEW_LENGTH),
        newPreview: truncatePreview(params.newSource, PREVIEW_LENGTH)
      },
    })

    // Write the updated notebook
    await writeNotebook(filePath, contentOld, contentNew, ctx.sessionID)

    // Calculate diff
    const filediff = calculateFileDiff(filePath, contentOld, contentNew)

    // Get the updated cell
    const updatedCell = updatedNotebook.cells[params.cellIndex]

    // Build output
    const output = buildEditOutput(
      displayPath,
      params.cellIndex,
      updatedCell.cell_type,
      oldSource,
      params.newSource,
      updatedNotebook
    )

    ctx.metadata({
      metadata: {
        filediff,
        cellIndex: params.cellIndex,
        cellType: updatedCell.cell_type
      }
    })

    return {
      metadata: {
        filediff
      },
      title: displayPath,
      output
    }
  }
})

function buildEditOutput(
  displayPath: string,
  cellIndex: number,
  cellType: string,
  oldSource: string,
  newSource: string,
  notebook: Notebook
): string {
  const parts: string[] = []

  parts.push(`✓ Edited cell ${cellIndex} in ${displayPath}`)
  parts.push("")
  parts.push(`Cell type: ${cellType.toUpperCase()}`)
  parts.push(`Old content:\n  ${truncatePreview(oldSource, PREVIEW_LENGTH)}`)
  parts.push(`New content:\n  ${truncatePreview(newSource, PREVIEW_LENGTH)}`)
  parts.push("")
  parts.push(getNotebookSummary(notebook))

  return parts.join("\n")
}
