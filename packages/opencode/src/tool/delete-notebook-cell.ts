import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectory } from "./external-directory"
import {
  parseNotebook,
  stringifyNotebook,
  deleteCell,
  getNotebookSummary,
  normalizeSource,
  type Notebook
} from "../notebook"

const DESCRIPTION = `
Delete a cell from a Jupyter notebook (.ipynb) file.

This tool removes a cell at the specified index permanently.
Be careful - this action cannot be undone unless you have version control.

Parameters:
- filePath: Path to the .ipynb file
- cellIndex: Zero-based index of the cell to delete

Use read_notebook first to see the cell indices and their content before deleting.
`.trim()

export const DeleteNotebookCellTool = Tool.define("delete_notebook_cell", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the .ipynb file"),
    cellIndex: z.number().int().min(0)
      .describe("Zero-based index of the cell to delete"),
  }),
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    const filePath = path.isAbsolute(params.filePath) 
      ? params.filePath 
      : path.join(Instance.directory, params.filePath)
    
    await assertExternalDirectory(ctx, filePath)
    
    const file = Bun.file(filePath)
    const stats = await file.stat().catch(() => {})
    
    if (!stats) {
      throw new Error(`File not found: ${filePath}`)
    }
    
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filePath}`)
    }

    await FileTime.assert(ctx.sessionID, filePath)
    const contentOld = await file.text()
    
    // Parse the notebook
    const result = parseNotebook(contentOld)
    
    if (!result.success) {
      throw new Error(`Failed to parse notebook: ${result.error}`)
    }
    
    const notebook = result.notebook!
    
    // Validate cell index
    if (params.cellIndex >= notebook.cells.length) {
      throw new Error(
        `Cell index ${params.cellIndex} out of bounds. ` +
        `Notebook has ${notebook.cells.length} cells (indices 0-${notebook.cells.length - 1})`
      )
    }
    
    // Get the cell info before deletion
    const cellToDelete = notebook.cells[params.cellIndex]
    const source = normalizeSource(cellToDelete.source)
    
    // Delete the cell
    const updatedNotebook = deleteCell(notebook, params.cellIndex)
    const contentNew = stringifyNotebook(updatedNotebook)
    
    // Ask for permission
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filePath)],
      always: ["*"],
      metadata: {
        filepath: filePath,
        cellIndex: params.cellIndex,
        cellType: cellToDelete.cell_type,
        deletedContent: source.slice(0, 100)
      },
    })
    
    // Write the updated notebook
    await FileTime.withLock(filePath, async () => {
      await file.write(contentNew)
      await Bus.publish(File.Event.Edited, { file: filePath })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: filePath,
        event: "change"
      })
      FileTime.read(ctx.sessionID, filePath)
    })
    
    // Calculate diff
    const filediff: Snapshot.FileDiff = {
      file: filePath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: contentOld.split("\n").length - contentNew.split("\n").length,
    }
    
    // Format output
    let output = `✓ Deleted cell ${params.cellIndex} from ${path.relative(Instance.worktree, filePath)}\n\n`
    output += `Deleted ${cellToDelete.cell_type.toUpperCase()} cell:\n`
    output += `  ${source.slice(0, 100)}${source.length > 100 ? "..." : ""}\n`
    output += `\n${getNotebookSummary(updatedNotebook)}`
    
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
      title: path.relative(Instance.worktree, filePath),
      output
    }
  }
})
