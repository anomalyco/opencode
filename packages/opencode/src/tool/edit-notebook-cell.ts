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
  editCell,
  getNotebookSummary,
  normalizeSource,
  type Notebook
} from "../notebook"

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

export const EditNotebookCellTool = Tool.define("edit_notebook_cell", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the .ipynb file"),
    cellIndex: z.number().int().min(0)
      .describe("Zero-based index of the cell to edit"),
    newSource: z.string().describe("New content for the cell"),
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
    
    // Get the old cell info for the diff
    const oldCell = notebook.cells[params.cellIndex]
    const oldSource = normalizeSource(oldCell.source)
    
    // Edit the cell
    const updatedNotebook = editCell(notebook, params.cellIndex, params.newSource)
    const contentNew = stringifyNotebook(updatedNotebook)
    
    // Ask for permission
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filePath)],
      always: ["*"],
      metadata: {
        filepath: filePath,
        cellIndex: params.cellIndex,
        cellType: oldCell.cell_type,
        oldPreview: oldSource.slice(0, 100),
        newPreview: params.newSource.slice(0, 100)
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
      deletions: 0,
    }
    
    // Simple line-based diff for summary
    const oldLines = contentOld.split("\n")
    const newLines = contentNew.split("\n")
    
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) {
        if (i < newLines.length && oldLines[i] !== newLines[i]) {
          filediff.additions++
        }
        if (i < oldLines.length && oldLines[i] !== newLines[i]) {
          filediff.deletions++
        }
      }
    }
    
    // Format output
    const updatedCell = updatedNotebook.cells[params.cellIndex]
    let output = `✓ Edited cell ${params.cellIndex} in ${path.relative(Instance.worktree, filePath)}\n\n`
    output += `Cell type: ${updatedCell.cell_type.toUpperCase()}\n`
    output += `Old content:\n  ${oldSource.slice(0, 100)}${oldSource.length > 100 ? "..." : ""}\n`
    output += `New content:\n  ${params.newSource.slice(0, 100)}${params.newSource.length > 100 ? "..." : ""}\n`
    output += `\n${getNotebookSummary(updatedNotebook)}`
    
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
      title: path.relative(Instance.worktree, filePath),
      output
    }
  }
})
