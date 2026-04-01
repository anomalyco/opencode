import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { assertSafePath } from "./path-guard"
import { assertExternalDirectory } from "./external-directory"

// Minimal .ipynb cell types
type Cell = {
  cell_type: "code" | "markdown" | "raw"
  source: string | string[]
  outputs?: unknown[]
  metadata?: Record<string, unknown>
  id?: string
  execution_count?: number | null
}

type Notebook = {
  nbformat: number
  nbformat_minor: number
  metadata?: Record<string, unknown>
  cells: Cell[]
}

function cellSource(c: Cell): string {
  return Array.isArray(c.source) ? c.source.join("") : c.source
}

function readNotebook(raw: string): Notebook {
  const nb = JSON.parse(raw) as Notebook
  if (!Array.isArray(nb.cells)) throw new Error("Invalid .ipynb: missing cells array")
  return nb
}

/** Format a notebook as readable text (for read tool rendering) */
export function renderNotebook(raw: string): string {
  const nb = readNotebook(raw)
  return nb.cells
    .map((c, i) => {
      const src = cellSource(c)
      const header = `[Cell ${i + 1}] ${c.cell_type}`
      const body = src || "(empty)"
      return `${header}\n${"─".repeat(40)}\n${body}`
    })
    .join("\n\n")
}

export const NotebookEditTool = Tool.define("notebook_edit", {
  description:
    "Edit a Jupyter notebook (.ipynb) by inserting, replacing, or deleting cells. Use this tool for .ipynb files instead of the standard edit tool.",
  parameters: z.object({
    filePath: z.string().describe("Absolute path to the .ipynb file"),
    operation: z.enum(["insert", "replace", "delete"]).describe("Operation to perform on cells"),
    index: z.number().int().min(0).describe("Zero-based cell index to target"),
    cellType: z
      .enum(["code", "markdown", "raw"])
      .optional()
      .describe("Cell type for insert/replace operations (default: code)"),
    source: z.string().optional().describe("Cell source content for insert/replace operations"),
  }),
  async execute(params, ctx) {
    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)

    assertSafePath(filePath)
    await assertExternalDirectory(ctx, filePath)

    if (!filePath.endsWith(".ipynb")) throw new Error("notebook_edit only works on .ipynb files")

    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filePath)],
      always: ["*"],
      metadata: { filepath: filePath },
    })

    const raw = await Bun.file(filePath).text()
    const nb = readNotebook(raw)

    const { operation, index, cellType = "code", source = "" } = params

    if (operation === "insert") {
      const cell: Cell = { cell_type: cellType, source, metadata: {}, outputs: cellType === "code" ? [] : undefined }
      if (cell.outputs === undefined) delete cell.outputs
      nb.cells.splice(index, 0, cell)
    } else if (operation === "replace") {
      if (index >= nb.cells.length) throw new Error(`Cell index ${index} out of range (${nb.cells.length} cells)`)
      nb.cells[index] = {
        ...nb.cells[index],
        cell_type: cellType,
        source,
      }
    } else if (operation === "delete") {
      if (index >= nb.cells.length) throw new Error(`Cell index ${index} out of range (${nb.cells.length} cells)`)
      nb.cells.splice(index, 1)
    }

    const updated = JSON.stringify(nb, null, 1)
    await Bun.write(filePath, updated)

    const cellCount = nb.cells.length
    return {
      title: `${operation} cell at index ${index} in ${path.basename(filePath)}`,
      metadata: { filepath: filePath, operation, index, cellCount },
      output: `Successfully performed ${operation} on cell ${index}. Notebook now has ${cellCount} cells.`,
    }
  },
})
