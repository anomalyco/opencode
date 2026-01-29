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
  addCell,
  getNotebookSummary,
  type Notebook,
  type CellType
} from "../notebook"

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

export const AddNotebookCellTool = Tool.define("add_notebook_cell", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the .ipynb file"),
    cellType: z.enum(["code", "markdown", "raw"])
      .describe("Type of cell to create"),
    source: z.string().describe("Content for the new cell"),
    position: z.number().int().min(0).optional()
      .describe("Zero-based index where to insert (default: at end)"),
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
    
    // Validate position
    if (params.position !== undefined && params.position > notebook.cells.length) {
      throw new Error(
        `Position ${params.position} out of bounds. ` +
        `Notebook has ${notebook.cells.length} cells (valid range: 0-${notebook.cells.length})`
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
    const insertPosition = params.position ?? notebook.cells.length
    
    // Ask for permission
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filePath)],
      always: ["*"],
      metadata: {
        filepath: filePath,
        cellType: params.cellType,
        position: insertPosition,
        preview: params.source.slice(0, 100)
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
      additions: contentNew.split("\n").length - contentOld.split("\n").length,
      deletions: 0,
    }
    
    // Format output
    const preview = params.source.slice(0, 100)
    let output = `✓ Added ${params.cellType.toUpperCase()} cell at position ${insertPosition}\n`
    output += `File: ${path.relative(Instance.worktree, filePath)}\n\n`
    output += `Content:\n  ${preview}${params.source.length > 100 ? "..." : ""}\n`
    output += `\n${getNotebookSummary(updatedNotebook)}`
    
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
      title: path.relative(Instance.worktree, filePath),
      output
    }
  }
})
