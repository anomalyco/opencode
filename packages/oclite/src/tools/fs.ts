import fs from "fs/promises"
import path from "path"
import { Effect, Schema } from "effect"
import { Tool, ToolFailure, type ToolExecuteContext, type ToolSchema } from "@opencode-ai/llm"
import EDIT from "@/tool/edit.txt"
import READ from "@/tool/read.txt"
import WRITE from "@/tool/write.txt"
import type { OcliteTool, RunToolContext, ToolAccess } from "../contract"
import { dataDir } from "../util/paths"

// opencode's truncation policy (tool/truncate.ts constants and hint), without its cleanup fiber.
export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024

type Target = { path: string; kind: "file" | "directory" }
/** Built-in tools also name the paths they touch (external_directory check) and may derive their timeout. */
export interface BuiltinTool extends OcliteTool {
  readonly paths?: (input: unknown) => readonly Target[]
  readonly timeoutFor?: (input: unknown) => number
}

// Parameter names and descriptions match opencode's read/write/edit, so its .txt descriptions apply unchanged.
const DEFAULT_LIMIT = 2000
const MAX_LINE = 2000
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const ReadParameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file or directory to read" }),
  offset: Schema.optional(Count).annotate({ description: "The line number to start reading from (1-indexed)" }),
  limit: Schema.optional(Count).annotate({ description: "The maximum number of lines to read (defaults to 2000)" }),
})
const WriteParameters = Schema.Struct({
  content: Schema.String.annotate({ description: "The content to write to the file" }),
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to write (must be absolute, not relative)",
  }),
})
const EditParameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
  oldString: Schema.String.annotate({ description: "The text to replace" }),
  newString: Schema.String.annotate({ description: "The text to replace it with (must be different from oldString)" }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description: "Replace all occurrences of oldString (default false)",
  }),
})

export function fsTools(ctx: RunToolContext) {
  const resolve = (file: string) => path.resolve(ctx.cwd, file)
  const relative = (file: string) => path.relative(ctx.cwd, resolve(file)) || "."
  return [
    define({
      name: "read",
      description: READ,
      parameters: ReadParameters,
      readOnly: true,
      access: (params) => ({ permission: "read", patterns: [resolve(params.filePath)], always: ["*"] }),
      summarize: (params) => `read ${relative(params.filePath)}`,
      paths: (params) => [{ path: params.filePath, kind: "file" }],
      execute: (params) =>
        attempt(() => read(resolve(params.filePath), params.offset || 1, params.limit ?? DEFAULT_LIMIT)),
    }),
    define({
      name: "write",
      description: WRITE,
      parameters: WriteParameters,
      readOnly: false,
      access: (params) => ({ permission: "write", patterns: [relative(params.filePath)], always: ["*"] }),
      summarize: (params) => `write ${relative(params.filePath)}`,
      paths: (params) => [{ path: params.filePath, kind: "file" }],
      execute: (params) =>
        attempt(async () => {
          await Bun.write(resolve(params.filePath), params.content)
          return "Wrote file successfully."
        }),
    }),
    define({
      name: "edit",
      description: EDIT,
      parameters: EditParameters,
      readOnly: false,
      access: (params) => ({ permission: "edit", patterns: [relative(params.filePath)], always: ["*"] }),
      summarize: (params) => `edit ${relative(params.filePath)}`,
      paths: (params) => [{ path: params.filePath, kind: "file" }],
      execute: (params) => attempt(() => edit(resolve(params.filePath), params)),
    }),
  ]
}

async function read(file: string, offset: number, limit: number) {
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat) throw new Error(`File not found: ${file}`)
  if (stat.isDirectory()) {
    const entries = (await fs.readdir(file, { withFileTypes: true }))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort()
    const shown = entries.slice(offset - 1, offset - 1 + limit)
    const more = offset - 1 + shown.length < entries.length
    const footer = more
      ? `(Showing ${shown.length} of ${entries.length} entries. Use offset=${offset + shown.length} to continue.)`
      : `(${entries.length} entries)`
    return [`<path>${file}</path>`, `<type>directory</type>`, "<entries>", ...shown, "", footer, "</entries>"].join(
      "\n",
    )
  }
  const bytes = await Bun.file(file).bytes()
  if (bytes.subarray(0, 8192).includes(0)) throw new Error(`Cannot read binary file: ${file}`)
  const lines = new TextDecoder().decode(bytes).split("\n")
  const count = bytes.length === 0 ? 0 : lines.length
  if (count < offset && !(count === 0 && offset === 1))
    throw new Error(`Offset ${offset} is out of range for this file (${count} lines)`)
  const shown = lines.slice(offset - 1, offset - 1 + limit)
  const last = offset + shown.length - 1
  const footer =
    last < count
      ? `(Showing lines ${offset}-${last} of ${count}. Use offset=${last + 1} to continue.)`
      : `(End of file - total ${count} lines)`
  const body = shown
    .map(
      (line, index) =>
        `${index + offset}: ${line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}... (line truncated to ${MAX_LINE} chars)` : line}`,
    )
    .join("\n")
  return [`<path>${file}</path>`, `<type>file</type>`, "<content>", body, "", footer, "</content>"].join("\n")
}

async function edit(file: string, params: typeof EditParameters.Type) {
  if (params.oldString === params.newString)
    throw new Error("No changes to apply: oldString and newString are identical.")
  // opencode: an empty oldString creates the file (or replaces it) with newString.
  if (params.oldString === "") {
    await Bun.write(file, params.newString)
    return "Edit applied successfully."
  }
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat) throw new Error(`File ${file} not found`)
  if (stat.isDirectory()) throw new Error(`Path is a directory, not a file: ${file}`)
  const content = await Bun.file(file).text()
  const matches = content.split(params.oldString).length - 1
  if (matches === 0)
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    )
  if (matches > 1 && !params.replaceAll)
    throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.")
  const index = content.indexOf(params.oldString)
  const next = params.replaceAll
    ? content.replaceAll(params.oldString, () => params.newString)
    : content.slice(0, index) + params.newString + content.slice(index + params.oldString.length)
  await Bun.write(file, next)
  return `Edit applied successfully.${params.replaceAll && matches > 1 ? ` (${matches} replacements)` : ""}`
}

/** Schema-typed built-in tool; `execute` returns the model-facing text. */
export function define<A>(input: {
  name: string
  description?: string
  parameters: ToolSchema<A>
  readOnly: boolean
  timeoutMs?: number
  access: (params: A) => ToolAccess
  summarize: (params: A) => string
  paths?: (params: A) => readonly Target[]
  timeoutFor?: (params: A) => number
  execute: (params: A, call?: ToolExecuteContext) => Effect.Effect<string, ToolFailure>
}): BuiltinTool {
  return {
    name: input.name,
    tool: Tool.make({
      description: input.description ?? "",
      parameters: input.parameters,
      success: Schema.String,
      execute: input.execute,
    }),
    readOnly: input.readOnly,
    timeoutMs: input.timeoutMs ?? 30_000,
    access: (params) => input.access(params as A),
    summarize: (params) => input.summarize(params as A),
    paths: input.paths && ((params) => input.paths!(params as A)),
    timeoutFor: input.timeoutFor && ((params) => input.timeoutFor!(params as A)),
  }
}

/** Runs an async body, turning a thrown Error into a ToolFailure the model sees. */
export function attempt<A>(body: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({
    try: body,
    catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
  })
}

/** Cuts output at 2000 lines / 50 KB; the full text goes to tool-output/<session>/<call>.txt, named in the hint. */
export async function truncate(text: string, session: string, call: string) {
  const bytes = Buffer.byteLength(text)
  const lines = text.split("\n")
  if (lines.length <= MAX_LINES && bytes <= MAX_BYTES) return { text, bytes }
  const kept: string[] = []
  const size = { bytes: 0, hitBytes: false }
  for (const line of lines.slice(0, MAX_LINES)) {
    const next = Buffer.byteLength(line) + (kept.length ? 1 : 0)
    if (size.bytes + next > MAX_BYTES) {
      size.hitBytes = true
      break
    }
    kept.push(line)
    size.bytes += next
  }
  // Ids come from the model server; keep them to one safe path segment each.
  const root = path.join(dataDir(), "tool-output")
  const file = path.join(root, safe(session), `${safe(call)}.txt`)
  if (path.relative(root, file).startsWith("..")) throw new Error(`overflow path escapes ${root}`)
  await Bun.write(file, text)
  const removed = size.hitBytes ? `${bytes - size.bytes} bytes` : `${lines.length - kept.length} lines`
  const hint = `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`
  return { text: `${kept.join("\n")}\n\n...${removed} truncated...\n\n${hint}`, bytes, overflow_path: file }
}

function safe(segment: string) {
  return segment.replace(/[^A-Za-z0-9_-]/g, "_") || "_"
}
