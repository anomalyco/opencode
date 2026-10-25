import { Effect, Schema } from "effect"
import * as path from "path"
import * as Tool from "./tool"
import { createTwoFilesPatch } from "diff"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FileSystem } from "@bolt-ai/core/filesystem"
import { Watcher } from "@bolt-ai/core/filesystem/watcher"
import { FSUtil } from "@bolt-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { trimDiff } from "./edit"
import DESCRIPTION from "./notebook.txt"

const MAX_SOURCE_LINES = 50
const MAX_OUTPUT_PREVIEW = 200

export type Cell = { [key: string]: unknown }
export type Notebook = { [key: string]: unknown; cells: Cell[] }

/**
 * Parse .ipynb JSON text. The result keeps every field of the original
 * document (nbformat, metadata, cell ids, unknown keys) because nothing is
 * projected into a narrower shape; manipulation functions only touch the
 * fields they must.
 */
export function parse(text: string): Notebook {
  const raw: unknown = JSON.parse(text)
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("notebook must be a JSON object")
  }
  const nb = raw as { [key: string]: unknown }
  if (!Array.isArray(nb.cells)) throw new Error("notebook has no cells array")
  for (const cell of nb.cells) {
    if (typeof cell !== "object" || cell === null || Array.isArray(cell)) {
      throw new Error("notebook cells must be JSON objects")
    }
  }
  return nb as Notebook
}

/** Serialize with Jupyter's on-disk convention: indent 1 and a trailing newline. */
export function serialize(nb: Notebook): string {
  return `${JSON.stringify(nb, null, 1)}\n`
}

/** Join a cell's source (string or array-of-lines) into one string. */
export function sourceText(cell: Cell): string {
  if (typeof cell.source === "string") return cell.source
  if (Array.isArray(cell.source)) return cell.source.filter((line) => typeof line === "string").join("")
  return ""
}

/** Split source text into nbformat's array-of-lines shape, each line keeping its newline. */
export function splitSource(text: string): string[] {
  if (text === "") return []
  return text.split(/(?<=\n)/)
}

function requireCell(nb: Notebook, index: number): Cell {
  const cell = nb.cells[index]
  if (cell === undefined) {
    throw new Error(
      `cell index ${index} is out of range (notebook has ${nb.cells.length} cell${nb.cells.length === 1 ? "" : "s"})`,
    )
  }
  return cell
}

/**
 * Replace the source of the cell at index. Outputs and execution_count are
 * cleared only when the cell is a code cell and its source actually changed;
 * an identical source leaves the notebook byte-identical.
 */
export function editCell(nb: Notebook, index: number, source: string): Notebook {
  const existing = requireCell(nb, index)
  const out = structuredClone(nb)
  if (sourceText(existing) === source) return out
  const cell = out.cells[index]
  cell.source = splitSource(source)
  if (cell.cell_type === "code") {
    cell.outputs = []
    cell.execution_count = null
  }
  return out
}

/**
 * Insert a new cell at index (existing cells shift down; index === cells.length
 * appends). A cell id is generated unless one is passed, matching nbformat 4.5+.
 */
export function insertCell(
  nb: Notebook,
  index: number,
  type: "code" | "markdown",
  source: string,
  id?: string,
): Notebook {
  if (index < 0 || index > nb.cells.length) {
    throw new Error(
      `insert index ${index} is out of range (notebook has ${nb.cells.length} cells; valid indices are 0 to ${nb.cells.length})`,
    )
  }
  const out = structuredClone(nb)
  const cell: Cell = {
    cell_type: type,
    id: id ?? Math.random().toString(36).slice(2, 10),
    metadata: {},
    source: splitSource(source),
    ...(type === "code" ? { outputs: [], execution_count: null } : {}),
  }
  out.cells.splice(index, 0, cell)
  return out
}

/** Remove the cell at index. */
export function deleteCell(nb: Notebook, index: number): Notebook {
  requireCell(nb, index)
  const out = structuredClone(nb)
  out.cells.splice(index, 1)
  return out
}

/** One-line summary of a code cell's outputs, with a capped text preview. */
export function outputsLabel(cell: Cell): string {
  if (cell.cell_type !== "code") return ""
  const outputs = Array.isArray(cell.outputs) ? cell.outputs : []
  if (outputs.length === 0) return "no outputs"
  const types = outputs
    .map((output) =>
      typeof output === "object" && output !== null ? String((output as Cell).output_type ?? "unknown") : "unknown",
    )
    .join(", ")
  const first = outputs[0]
  const text = typeof first === "object" && first !== null ? previewText(first as Cell) : ""
  const preview = text.length > MAX_OUTPUT_PREVIEW ? `${text.slice(0, MAX_OUTPUT_PREVIEW)}...` : text
  const label = `${outputs.length} output${outputs.length === 1 ? "" : "s"} (${types})`
  return preview ? `${label}: ${preview.trimEnd()}` : label
}

function previewText(output: Cell): string {
  if (typeof output.text === "string") return output.text
  if (Array.isArray(output.text)) return output.text.join("")
  if (typeof output.data === "object" && output.data !== null) {
    const plain = (output.data as Cell)["text/plain"]
    if (typeof plain === "string") return plain
    if (Array.isArray(plain)) return plain.join("")
  }
  if (typeof output.ename === "string")
    return `${output.ename}: ${typeof output.evalue === "string" ? output.evalue : ""}`
  return ""
}

/** Render every cell with its index, type, source, and outputs summary. */
export function renderCells(nb: Notebook): string {
  if (nb.cells.length === 0) return "notebook has no cells"
  return nb.cells
    .map((cell, index) => {
      const type = typeof cell.cell_type === "string" ? cell.cell_type : "unknown"
      const outputs = outputsLabel(cell)
      const header = `[${index}] ${type}${outputs ? ` | ${outputs}` : ""}`
      const lines = sourceText(cell).split("\n")
      const shown = lines.slice(0, MAX_SOURCE_LINES)
      const body = shown.map((line) => `  ${line}`).join("\n")
      const more = lines.length > MAX_SOURCE_LINES ? `\n  ... (${lines.length - MAX_SOURCE_LINES} more lines)` : ""
      return `${header}\n${body}${more}`
    })
    .join("\n\n")
}

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the .ipynb notebook file" }),
  action: Schema.Literals(["read", "edit", "insert", "delete"]).annotate({
    description: "The notebook operation to perform",
  }),
  index: Schema.optional(Schema.Number).annotate({
    description:
      "0-based cell index. Required for edit, insert, and delete. For insert, the new cell is placed at this index.",
  }),
  source: Schema.optional(Schema.String).annotate({
    description: "The full new cell source. Required for edit and insert.",
  }),
  cellType: Schema.optional(Schema.Literals(["code", "markdown"])).annotate({
    description: "The type of the new cell. Required for insert.",
  }),
})

type Metadata = { [key: string]: unknown }

export const NotebookTool = Tool.define(
  "notebook",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filepath)
          if (!filepath.endsWith(".ipynb")) {
            throw new Error("the notebook tool only works with .ipynb files; use read/edit/write for other files")
          }
          if (!(yield* fs.existsSafe(filepath))) throw new Error(`notebook not found: ${filepath}`)

          const original = yield* Effect.promise(() => Bun.file(filepath).text())
          const nb = parse(original)
          const name = path.basename(filepath)

          if (params.action === "read") {
            return {
              title: `${name} (${nb.cells.length} cell${nb.cells.length === 1 ? "" : "s"})`,
              output: renderCells(nb),
              metadata: { cells: nb.cells.length },
            }
          }

          if (params.index === undefined) throw new Error(`${params.action} requires the index parameter`)
          const index = params.index
          const next = yield* Effect.sync(() => {
            if (params.action === "delete") return deleteCell(nb, index)
            if (params.source === undefined) throw new Error(`${params.action} requires the source parameter`)
            if (params.action === "edit") return editCell(nb, index, params.source)
            if (!params.cellType) throw new Error("insert requires the cellType parameter")
            return insertCell(nb, index, params.cellType, params.source)
          })

          const serialized = serialize(next)
          const diff = trimDiff(createTwoFilesPatch(filepath, filepath, original, serialized))
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filepath)],
            always: ["*"],
            metadata: { filepath, diff },
          })

          yield* fs.writeWithDirs(filepath, serialized)
          yield* events.publish(FileSystem.Event.Edited, { file: filepath })
          yield* events.publish(Watcher.Event.Updated, { file: filepath, event: "change" })

          const verb = params.action === "edit" ? "Edited" : params.action === "insert" ? "Inserted" : "Deleted"
          return {
            title: `${name} ${params.action} cell ${params.index}`,
            output: `${verb} cell ${params.index} in ${name}. Notebook now has ${next.cells.length} cell${next.cells.length === 1 ? "" : "s"}.`,
            metadata: { filepath, action: params.action, index: params.index, cells: next.cells.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
