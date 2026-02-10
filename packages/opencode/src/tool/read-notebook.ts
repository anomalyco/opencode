import z from "zod"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import {
  getNotebookSummary,
  formatCellInfo,
  normalizeSource,
  DEFAULT_MAX_PREVIEW_LENGTH,
  type Notebook,
  type CellOutput
} from "../notebook"
import { loadNotebook, getDisplayPath, sliceWithTruncation } from "./notebook-utils"

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

// Display constants
const SEPARATOR_LENGTH = 60
const SEPARATOR_CHAR = "─"
const DOUBLE_SEPARATOR_CHAR = "═"
const OUTPUT_PREVIEW_LENGTH = 100

export const ReadNotebookTool = Tool.define("read_notebook", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().min(1, "File path cannot be empty")
      .describe("The absolute path to the .ipynb file to read"),
    maxPreviewLength: z.number().int().min(1).optional().default(DEFAULT_MAX_PREVIEW_LENGTH)
      .describe("Maximum length of cell source to display"),
  }),
  async execute(params, ctx) {
    const { notebook, filePath } = await loadNotebook(params, ctx)

    // Check if file extension is .ipynb
    if (!filePath.toLowerCase().endsWith(".ipynb")) {
      ctx.metadata({
        metadata: {
          warning: "File does not have .ipynb extension"
        }
      })
    }

    const displayPath = getDisplayPath(filePath)

    // Build output
    const output = buildNotebookOutput(notebook, displayPath, params.maxPreviewLength)

    FileTime.read(ctx.sessionID, filePath)

    return {
      metadata: {
        notebook: {
          cellCount: notebook.cells.length,
          language: notebook.metadata.language_info?.name,
          format: `${notebook.nbformat}.${notebook.nbformat_minor}`
        }
      },
      title: displayPath,
      output
    }
  }
})

function buildNotebookOutput(
  notebook: Notebook,
  displayPath: string,
  maxPreviewLength: number
): string {
  const parts: string[] = []

  // File info header
  parts.push(`📓 ${displayPath}`)
  parts.push(`${SEPARATOR_CHAR.repeat(SEPARATOR_LENGTH)}\n`)

  // Summary
  parts.push(getNotebookSummary(notebook))
  parts.push("")

  // Kernel info
  const kernel = notebook.metadata.kernelspec
  if (kernel) {
    parts.push(`Kernel: ${kernel.display_name} (${kernel.name})`)
  }

  // Cell details section
  parts.push(`\n${DOUBLE_SEPARATOR_CHAR.repeat(SEPARATOR_LENGTH)}`)
  parts.push("CELLS")
  parts.push(`${DOUBLE_SEPARATOR_CHAR.repeat(SEPARATOR_LENGTH)}\n`)

  // Process each cell
  for (const [index, cell] of notebook.cells.entries()) {
    parts.push(formatCellInfo(cell, index, maxPreviewLength))

    // Add source preview
    const source = normalizeSource(cell.source)
    if (source.trim()) {
      const { value: preview, truncated } = sliceWithTruncation(source, maxPreviewLength)

      parts.push("```")
      if (cell.cell_type === "code" && notebook.metadata.language_info?.name) {
        parts.push(notebook.metadata.language_info.name)
      }
      parts.push(preview)
      if (truncated) {
        parts.push("... (truncated)")
      }
      parts.push("```")
    }

    // Add outputs for code cells
    if (cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0) {
      parts.push(formatOutputs(cell.outputs))
    }

    parts.push("")
  }

  return parts.join("\n")
}

function formatOutputs(outputs: CellOutput[]): string {
  const lines: string[] = ["Outputs:"]

  for (const [index, output] of outputs.entries()) {
    lines.push(`  [${index}] ${output.output_type}`)

    // Handle different output types
    switch (output.output_type) {
      case "stream": {
        const text = typeof output.text === "string" ? output.text : output.text.join("")
        const { value } = sliceWithTruncation(text, OUTPUT_PREVIEW_LENGTH)
        lines.push(`    ${value}`)
        break
      }
      case "error":
        lines.push(`    ${output.ename}: ${output.evalue}`)
        break
      case "execute_result":
      case "display_data":
        const dataKeys = Object.keys(output.data).join(", ")
        lines.push(`    data: ${dataKeys}`)
        if ("text" in output.data || "text/plain" in output.data) {
          const text = String((output.data as Record<string, unknown>).text ?? (output.data as Record<string, unknown>)["text/plain"] ?? "")
          const { value } = sliceWithTruncation(text, OUTPUT_PREVIEW_LENGTH)
          lines.push(`    ${value}`)
        }
        break
    }
  }

  return lines.join("\n")
}
