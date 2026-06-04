import { Effect, Schema, Stream } from "effect"
import path from "path"
import os from "os"
import { unlink } from "node:fs/promises"
import * as Tool from "./tool"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./notebook.txt"

type CellOutput = {
  output_type: string
  name?: string
  text?: string | string[]
  data?: Record<string, unknown>
  ename?: string
  evalue?: string
  traceback?: string[]
  execution_count?: number | null
}

type NotebookCell = {
  cell_type: string
  id?: string
  metadata: Record<string, unknown>
  source: string | string[]
  outputs?: CellOutput[]
  execution_count?: number | null
}

type Notebook = {
  nbformat: number
  nbformat_minor: number
  metadata: Record<string, unknown>
  cells: NotebookCell[]
}

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Absolute path to the .ipynb notebook file",
  }),
  operation: Schema.Literals(["read", "edit", "execute"]).annotate({
    description:
      "read: display all cells and outputs | edit: replace a cell's source by index | execute: run cells via Jupyter and capture outputs",
  }),
  cellIndex: Schema.optional(Schema.Number).annotate({
    description:
      "Zero-based cell index. Required for 'edit'. For 'execute', omit to run all cells or provide an index to run one cell.",
  }),
  newSource: Schema.optional(Schema.String).annotate({
    description: "Replacement source code or text for the cell. Required for 'edit'.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Execution timeout in seconds (default: 60). Only applies to 'execute'.",
  }),
})

function joinSource(source: string | string[]) {
  return Array.isArray(source) ? source.join("") : source
}

function formatOutput(output: CellOutput) {
  if (output.output_type === "stream") {
    const text = joinSource((output.text ?? "") as string | string[])
    return `[${output.name ?? "stdout"}]: ${text}`
  }
  if (output.output_type === "error") {
    return `[error] ${output.ename}: ${output.evalue}\n${(output.traceback ?? []).join("\n")}`
  }
  if (output.output_type === "execute_result" || output.output_type === "display_data") {
    const data = output.data ?? {}
    const text = (data["text/plain"] ?? data["text/html"] ?? "") as string
    return `[result]: ${text}`
  }
  return `[${output.output_type}]`
}

function formatCell(cell: NotebookCell, index: number) {
  const source = joinSource(cell.source)
  const lines = [`--- Cell ${index} [${cell.cell_type}] ---`, source || "(empty)"]
  if (cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0) {
    lines.push("Output:")
    for (const output of cell.outputs) lines.push(formatOutput(output))
  }
  return lines.join("\n")
}

export const NotebookTool = Tool.define(
  "notebook",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const spawner = yield* ChildProcessSpawner

    const readNotebook = Effect.fn("NotebookTool.readNotebook")(function* (filepath: string) {
      const exists = yield* fs.existsSafe(filepath)
      if (!exists) return yield* Effect.fail(new Error(`Notebook not found: ${filepath}`))
      return yield* Effect.promise(() => Bun.file(filepath).json() as Promise<Notebook>)
    })

    const runJupyter = Effect.fn("NotebookTool.runJupyter")(function* (args: string[], cwd: string) {
      let output = ""
      const exitCode = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make("jupyter", args, {
              cwd,
              env: process.env,
              stdin: "ignore",
              detached: false,
            }),
          )
          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk: string) =>
              Effect.sync(() => {
                output += chunk
              }),
            ),
          )
          return yield* handle.exitCode
        }),
      ).pipe(Effect.orDie)
      return { output, exitCode }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)

          if (!filepath.endsWith(".ipynb"))
            throw new Error(`File must be a Jupyter notebook (.ipynb): ${filepath}`)

          if (params.operation === "read") {
            yield* ctx.ask({
              permission: "read",
              patterns: [path.relative(instance.worktree, filepath)],
              always: ["*.ipynb"],
              metadata: {},
            })

            const notebook = yield* readNotebook(filepath)
            const kernelName =
              ((notebook.metadata?.kernelspec as Record<string, string>)?.display_name) ?? "unknown"
            const cells = notebook.cells.map((cell: NotebookCell, i: number) => formatCell(cell, i)).join("\n\n")

            return {
              title: path.relative(instance.worktree, filepath),
              output: [
                `<notebook path="${filepath}">`,
                `<kernel>${kernelName}</kernel>`,
                `<cell_count>${notebook.cells.length}</cell_count>`,
                `<cells>`,
                cells,
                `</cells>`,
                `</notebook>`,
              ].join("\n"),
              metadata: {
                cellCount: notebook.cells.length,
                kernel: kernelName,
              },
            }
          }

          if (params.operation === "edit") {
            if (params.cellIndex === undefined) throw new Error("cellIndex is required for 'edit'")
            if (params.newSource === undefined) throw new Error("newSource is required for 'edit'")

            yield* ctx.ask({
              permission: "edit",
              patterns: [path.relative(instance.worktree, filepath)],
              always: ["*.ipynb"],
              metadata: { filepath },
            })

            const notebook = yield* readNotebook(filepath)
            if (params.cellIndex < 0 || params.cellIndex >= notebook.cells.length)
              throw new Error(
                `cellIndex ${params.cellIndex} out of range — notebook has ${notebook.cells.length} cells (0–${notebook.cells.length - 1})`,
              )

            const cell = notebook.cells[params.cellIndex]
            notebook.cells[params.cellIndex] = {
              ...cell,
              source: Array.isArray(cell.source)
                ? params.newSource.split("\n").map((line: string, i: number, arr: string[]) => (i < arr.length - 1 ? line + "\n" : line))
                : params.newSource,
              ...(cell.cell_type === "code" ? { outputs: [], execution_count: null } : {}),
            }

            yield* fs.writeWithDirs(filepath, JSON.stringify(notebook, null, 1))

            return {
              title: path.relative(instance.worktree, filepath),
              output: `Cell ${params.cellIndex} updated. Outputs cleared — run execute to refresh.`,
              metadata: { cellIndex: params.cellIndex },
            }
          }

          // execute operation
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filepath)],
            always: ["*.ipynb"],
            metadata: { filepath },
          })

          const timeoutSecs = params.timeout ?? 60

          if (params.cellIndex === undefined) {
            const result = yield* runJupyter(
              [
                "nbconvert",
                "--to",
                "notebook",
                "--execute",
                "--inplace",
                `--ExecutePreprocessor.timeout=${timeoutSecs}`,
                filepath,
              ],
              path.dirname(filepath),
            )

            if (result.exitCode !== 0)
              throw new Error(`Jupyter execution failed (exit ${result.exitCode}):\n${result.output}`)

            const notebook = yield* readNotebook(filepath)
            const summary = notebook.cells
              .filter((c: NotebookCell) => c.cell_type === "code" && c.outputs && c.outputs.length > 0)
              .map((c: NotebookCell, i: number) => formatCell(c, i))
              .join("\n\n")

            return {
              title: path.relative(instance.worktree, filepath),
              output: `All cells executed.\n\n${summary || "(no outputs)"}`,
              metadata: { exitCode: result.exitCode },
            }
          }

          // Single-cell execution via a temporary notebook
          const notebook = yield* readNotebook(filepath)
          if (params.cellIndex < 0 || params.cellIndex >= notebook.cells.length)
            throw new Error(
              `cellIndex ${params.cellIndex} out of range — notebook has ${notebook.cells.length} cells`,
            )

          const tmpPath = path.join(os.tmpdir(), `opencode-nb-${Date.now()}.ipynb`)

          const executedCell = yield* Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.promise(() => unlink(tmpPath).catch(() => undefined)),
              )

              const tmpNotebook: Notebook = {
                nbformat: notebook.nbformat,
                nbformat_minor: notebook.nbformat_minor,
                metadata: notebook.metadata,
                cells: [notebook.cells[params.cellIndex!]],
              }
              yield* fs.writeWithDirs(tmpPath, JSON.stringify(tmpNotebook, null, 1))

              const result = yield* runJupyter(
                [
                  "nbconvert",
                  "--to",
                  "notebook",
                  "--execute",
                  "--inplace",
                  `--ExecutePreprocessor.timeout=${timeoutSecs}`,
                  tmpPath,
                ],
                path.dirname(filepath),
              )

              if (result.exitCode !== 0)
                throw new Error(
                  `Cell ${params.cellIndex} execution failed (exit ${result.exitCode}):\n${result.output}`,
                )

              const executed = yield* Effect.promise(
                () => Bun.file(tmpPath).json() as Promise<Notebook>,
              )
              return executed.cells[0]
            }),
          ).pipe(Effect.orDie)

          notebook.cells[params.cellIndex] = {
            ...notebook.cells[params.cellIndex],
            outputs: executedCell.outputs ?? [],
            execution_count: executedCell.execution_count ?? null,
          }
          yield* fs.writeWithDirs(filepath, JSON.stringify(notebook, null, 1))

          return {
            title: path.relative(instance.worktree, filepath),
            output: `Cell ${params.cellIndex} executed.\n\n${formatCell(executedCell, params.cellIndex)}`,
            metadata: { cellIndex: params.cellIndex, exitCode: 0 },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
