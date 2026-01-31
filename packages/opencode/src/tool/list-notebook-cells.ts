import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import {
  parseNotebook,
  formatCellInfo,
  normalizeSource,
  type Notebook
} from "../notebook"

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

export const ListNotebookCellsTool = Tool.define("list_notebook_cells", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the .ipynb file"),
    cellType: z.enum(["code", "markdown", "raw"]).optional()
      .describe("Filter by cell type (optional)"),
    maxPreviewLength: z.number().optional().default(80)
      .describe("Maximum length of content preview"),
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
    const content = await file.text()
    
    // Parse the notebook
    const result = parseNotebook(content)
    
    if (!result.success) {
      throw new Error(`Failed to parse notebook: ${result.error}`)
    }
    
    const notebook = result.notebook!
    
    // Filter cells if requested
    let cells = notebook.cells
    if (params.cellType) {
      cells = cells.filter(c => c.cell_type === params.cellType)
    }
    
    // Build output
    let output = `📓 ${path.relative(Instance.worktree, filePath)}\n`
    output += `${"─".repeat(80)}\n\n`
    
    if (params.cellType) {
      output += `Showing ${params.cellType.toUpperCase()} cells only\n`
    }
    
    output += `Total cells: ${cells.length} / ${notebook.cells.length}\n\n`
    
    if (cells.length === 0) {
      output += "No cells found"
      if (params.cellType) {
        output += ` (filtering by ${params.cellType})`
      }
      output += "\n"
    } else {
      cells.forEach((cell, notebookIndex) => {
        // Find actual index in notebook
        const actualIndex = notebook.cells.indexOf(cell)
        output += formatCellInfo(cell, actualIndex) + "\n"
        
        // Add content preview
        const source = normalizeSource(cell.source)
        if (source.trim()) {
          const lines = source.split("\n")
          const preview = lines[0].trim().slice(0, params.maxPreviewLength)
          output += `  ${preview}${lines[0].length > params.maxPreviewLength ? "..." : ""}\n`
          
          // Show line count if multiline
          if (lines.length > 1) {
            output += `  (${lines.length} lines total)\n`
          }
        }
        
        output += "\n"
      })
    }
    
    FileTime.read(ctx.sessionID, filePath)
    
    return {
      metadata: {
        cellCount: cells.length,
        filteredBy: params.cellType
      },
      title: path.relative(Instance.worktree, filePath),
      output
    }
  }
})
