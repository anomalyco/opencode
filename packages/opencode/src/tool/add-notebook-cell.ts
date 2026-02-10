import z from "zod"
import { Tool } from "./tool"
import {
  addCell,
  stringifyNotebook,
  getNotebookSummary,
  type CellType
} from "../notebook"
import {
  loadNotebook,
  getDisplayPath,
  calculateFileDiff,
  writeNotebook,
  truncatePreview
} from "./notebook-utils"

const DESCRIPTION = `
Add a new cell to a Jupyter notebook (.ipynb) file.

This tool creates a new cell and inserts it at the specified position.
If no position is specified, the cell is added at the end of the notebook.

Parameters:
- filePath: Path to the .ipynb file
- cellType: Type of cell to create (code, markdown, or raw)
- source: Content for the new cell
- position: (optional) Zero-based index where to insert the cell

Examples:
- Add code cell at end: cellType="code", source="print('hello')"
- Add markdown at position 0: cellType="markdown", source="# Title", position=0
`.trim()

// Display constants
const PREVIEW_LENGTH = 100

export const AddNotebookCellTool = Tool.define("add_notebook_cell", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().min(1, "File path cannot be empty")
      .describe("The absolute path to the .ipynb file"),
    cellType: z.enum(["code", "markdown", "raw"])
      .describe("Type of cell to create"),
    source: z.string()
      .describe("Content for the new cell"),
    position: z.number().int().min(0).optional()
      .describe("Zero-based index where to insert (default: at end)"),
  }),
  async execute(params, ctx) {
    const { notebook, content: contentOld, filePath } = await loadNotebook(params, ctx)

    // Validate position
    const maxPosition = notebook.cells.length
    if (params.position !== undefined && params.position > maxPosition) {
      throw new RangeError(
        `Position ${params.position} out of bounds. ` +
        `Notebook has ${maxPosition} cells (valid range: 0-${maxPosition})`
      )
    }

    // Add the new cell
    const updatedNotebook = addCell(
      notebook,
      params.cellType as CellType,
      params.source,
      params.position
    )
    const contentNew = stringifyNotebook(updatedNotebook)

    // Determine the actual position where the cell was inserted
    const insertPosition = params.position ?? maxPosition

    // Ask for permission before writing
    const displayPath = getDisplayPath(filePath)
    await ctx.ask({
      permission: "edit",
      patterns: [displayPath],
      always: ["*"],
      metadata: {
        filepath: filePath,
        cellType: params.cellType,
        position: insertPosition,
        preview: truncatePreview(params.source, PREVIEW_LENGTH)
      },
    })

    // Write the updated notebook
    await writeNotebook(filePath, contentOld, contentNew, ctx.sessionID)

    // Calculate diff
    const filediff = calculateFileDiff(filePath, contentOld, contentNew)

    // Build output
    const output = buildAddOutput(
      displayPath,
      params.cellType,
      insertPosition,
      params.source,
      updatedNotebook
    )

    ctx.metadata({
      metadata: {
        filediff,
        cellType: params.cellType,
        position: insertPosition
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

function buildAddOutput(
  displayPath: string,
  cellType: string,
  position: number,
  source: string,
  notebook: Notebook
): string {
  const parts: string[] = []

  parts.push(`✓ Added ${cellType.toUpperCase()} cell at position ${position}`)
  parts.push(`File: ${displayPath}`)
  parts.push("")
  parts.push(`Content:`)
  parts.push(`  ${truncatePreview(source, PREVIEW_LENGTH)}`)
  parts.push("")
  parts.push(getNotebookSummary(notebook))

  return parts.join("\n")
}
