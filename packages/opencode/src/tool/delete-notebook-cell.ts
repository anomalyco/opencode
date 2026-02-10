import z from "zod"
import { Tool } from "./tool"
import {
  deleteCell,
  stringifyNotebook,
  getNotebookSummary,
  normalizeSource
} from "../notebook"
import {
  loadNotebook,
  getDisplayPath,
  calculateFileDiff,
  writeNotebook,
  truncatePreview
} from "./notebook-utils"

const DESCRIPTION = `
Delete a cell from a Jupyter notebook (.ipynb) file.

This tool removes a cell at the specified index permanently.
Be careful - this action cannot be undone unless you have version control.

Parameters:
- filePath: Path to the .ipynb file
- cellIndex: Zero-based index of the cell to delete

Use read_notebook first to see the cell indices and their content before deleting.
`.trim()

// Display constants
const PREVIEW_LENGTH = 100

export const DeleteNotebookCellTool = Tool.define("delete_notebook_cell", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().min(1, "File path cannot be empty")
      .describe("The absolute path to the .ipynb file"),
    cellIndex: z.number().int().min(0, "Cell index must be non-negative")
      .describe("Zero-based index of the cell to delete"),
  }),
  async execute(params, ctx) {
    const { notebook, content: contentOld, filePath } = await loadNotebook(params, ctx)

    // Validate cell index
    if (params.cellIndex >= notebook.cells.length) {
      throw new Error(
        `Cell index ${params.cellIndex} out of bounds. ` +
        `Notebook has ${notebook.cells.length} cells (valid indices: 0-${notebook.cells.length - 1})`
      )
    }

    // Get the cell info before deletion
    const cellToDelete = notebook.cells[params.cellIndex]
    const source = normalizeSource(cellToDelete.source)

    // Delete the cell
    const updatedNotebook = deleteCell(notebook, params.cellIndex)
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
        cellType: cellToDelete.cell_type,
        deletedContent: truncatePreview(source, PREVIEW_LENGTH)
      },
    })

    // Write the updated notebook
    await writeNotebook(filePath, contentOld, contentNew, ctx.sessionID)

    // Calculate diff
    const filediff = calculateFileDiff(filePath, contentOld, contentNew)

    // Build output
    const output = buildDeleteOutput(
      displayPath,
      params.cellIndex,
      cellToDelete.cell_type,
      source,
      updatedNotebook
    )

    ctx.metadata({
      metadata: {
        filediff,
        cellIndex: params.cellIndex,
        cellType: cellToDelete.cell_type
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

function buildDeleteOutput(
  displayPath: string,
  cellIndex: number,
  cellType: string,
  deletedSource: string,
  notebook: Notebook
): string {
  const parts: string[] = []

  parts.push(`✓ Deleted cell ${cellIndex} from ${displayPath}`)
  parts.push("")
  parts.push(`Deleted ${cellType.toUpperCase()} cell:`)
  parts.push(`  ${truncatePreview(deletedSource, PREVIEW_LENGTH)}`)
  parts.push("")
  parts.push(getNotebookSummary(notebook))

  return parts.join("\n")
}
