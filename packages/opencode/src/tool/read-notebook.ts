import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { 
  parseNotebook, 
  getNotebookSummary, 
  formatCellInfo,
  normalizeSource,
  type Notebook 
} from "../notebook"

const DESCRIPTION = `
Read and parse a Jupyter notebook (.ipynb) file.

This tool reads a Jupyter notebook file and displays:
- Notebook metadata (format version, language, kernel info)
- Cell summary (total cells, breakdown by type)
- Detailed information for each cell including:
  - Cell type (code, markdown, raw)
  - Source content preview
  - Execution count (for code cells)
  - Outputs (for code cells)

Use this tool to explore the structure and content of Jupyter notebooks before making edits.
`.trim()

export const ReadNotebookTool = Tool.define("read_notebook", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the .ipynb file to read"),
    maxPreviewLength: z.number().optional().default(200)
      .describe("Maximum length of cell source to display (default 200)"),
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

    // Check if file extension is .ipynb
    if (!filePath.toLowerCase().endsWith(".ipynb")) {
      ctx.metadata({
        metadata: {
          warning: "File does not have .ipynb extension"
        }
      })
    }

    await FileTime.assert(ctx.sessionID, filePath)
    const content = await file.text()
    
    // Parse the notebook
    const result = parseNotebook(content)
    
    if (!result.success) {
      throw new Error(`Failed to parse notebook: ${result.error}`)
    }
    
    const notebook = result.notebook!
    
    // Build output
    let output = ""
    
    // Add file info
    output += `📓 ${path.relative(Instance.worktree, filePath)}\n`
    output += `${"─".repeat(60)}\n\n`
    
    // Add summary
    output += getNotebookSummary(notebook)
    output += "\n\n"
    
    // Add metadata
    if (notebook.metadata.kernelspec) {
      output += `Kernel: ${notebook.metadata.kernelspec.display_name} ` +
                `(${notebook.metadata.kernelspec.name})\n`
    }
    
    // Add cell details
    output += `\n${"═".repeat(60)}\n`
    output += "CELLS\n"
    output += `${"═".repeat(60)}\n\n`
    
    notebook.cells.forEach((cell, index) => {
      output += formatCellInfo(cell, index)
      output += "\n"
      
      // Add source preview
      const source = normalizeSource(cell.source)
      if (source.trim()) {
        const preview = source.slice(0, params.maxPreviewLength)
        output += "```"
        if (cell.cell_type === "code" && notebook.metadata.language_info?.name) {
          output += notebook.metadata.language_info.name
        }
        output += "\n"
        output += preview
        if (source.length > params.maxPreviewLength) {
          output += "\n... (truncated)"
        }
        output += "\n```\n"
      }
      
      // Add outputs for code cells
      if (cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0) {
        output += "Outputs:\n"
        cell.outputs.forEach((cellOutput, i) => {
          output += `  [${i}] ${cellOutput.output_type}\n`
          if ("text" in cellOutput) {
            output += `    ${String(cellOutput.text).slice(0, 100)}\n`
          }
        })
      }
      
      output += "\n"
    })
    
    FileTime.read(ctx.sessionID, filePath)
    
    return {
      metadata: {
        notebook: {
          cellCount: notebook.cells.length,
          language: notebook.metadata.language_info?.name,
          format: `${notebook.nbformat}.${notebook.nbformat_minor}`
        }
      },
      title: path.relative(Instance.worktree, filePath),
      output
    }
  }
})
