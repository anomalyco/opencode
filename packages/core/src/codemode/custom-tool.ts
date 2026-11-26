export * as CodeModeCustomTool from "./custom-tool.js"

import { CodeMode } from "@opencode/codemode"
import { Context, type JsonSchema, Result, Schema, SchemaIssue } from "effect"
import matter from "gray-matter"
import path from "path"
import { ConfigMarkdown } from "../config/markdown.js"
import { CodeModeAgents } from "./agents.js"
import type { CodeModeTool } from "./tool.js"

/** Namespace prefix for user- and project-saved Code Mode tools (`tools.custom.<name>`). */
export const NAMESPACE = "custom"

/** Config subdirectories scanned for saved Code Mode tools (`<configDir>/tool/` and `<configDir>/tools/`). */
export const DIRECTORIES = ["tool", "tools"] as const

/** Maximum nested custom tool call depth (guards against accidental recursion). */
export const MAX_DEPTH = 4

/** Tools that a saved custom tool script may not invoke (prevents self-modifying scripts). */
export const FORBIDDEN_INNER_TOOLS = new Set(["opencode.tool.create", "opencode.tool.delete"])

/** Node globals models reach for that the Code Mode runtime does not have, with what to do instead. */
const UNAVAILABLE_GLOBALS: Readonly<Record<string, string>> = {
  process:
    "Relative paths already resolve against the project directory, so use them as they are (for example Bun.file(\"data/x.csv\")); there is no process.cwd() or process.env.",
  __dirname: "Relative paths already resolve against the project directory.",
  __filename: "Relative paths already resolve against the project directory.",
  setTimeout: "Timers are unavailable; await the calls you make instead.",
  setInterval: "Timers are unavailable; await the calls you make instead.",
}

export const DEFAULT_INPUT: JsonSchema.JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
}

/** Tracks current custom tool call nesting depth inside an execution fiber. */
export const Depth = Context.Reference<number>("@opencode/CodeModeCustomTool/Depth", {
  defaultValue: () => 0,
})

/** Tracks the active custom tool call chain for clear recursion error messages. */
export const CallStack = Context.Reference<ReadonlyArray<string>>("@opencode/CodeModeCustomTool/CallStack", {
  defaultValue: () => [],
})

export interface Name {
  /** Dotted identifier without the leading `custom.` namespace (e.g. `triage_prs` or `github.triage_prs`). */
  readonly id: string
  /** Leaf tool name (e.g. `triage_prs`). */
  readonly name: string
  /** Tool.Info namespace (e.g. `custom` or `custom.github`). */
  readonly namespace: string
  /** Full Code Mode path (e.g. `custom.triage_prs` or `custom.github.triage_prs`). */
  readonly qualified: string
  /** Path relative to `<configDir>/tools/` (e.g. `triage_prs.js` or `github/triage_prs.js`). */
  readonly relativePath: string
}

export interface Definition {
  readonly description: string
  readonly input: JsonSchema.JsonSchema
  readonly output?: JsonSchema.JsonSchema
  readonly compiledOutput?: CodeModeAgents.Output
  readonly code: string
  readonly tools: ReadonlyArray<string>
  readonly extensions: ReadonlyArray<CodeModeTool.ExtensionName>
}

export interface ScriptScan {
  readonly tools: ReadonlyArray<string>
  readonly extensions: ReadonlyArray<CodeModeTool.ExtensionName>
}

const Header = Schema.Struct({
  description: Schema.Trim.check(Schema.isNonEmpty()),
  input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  output: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
})

const decodeHeader = Schema.decodeUnknownResult(Header)
const formatIssue = SchemaIssue.makeFormatterDefault()
const segmentPattern = /^[A-Za-z0-9_-]+$/
const MAX_NAME_SEGMENTS = 4

export function parseName(raw: string): Result.Result<Name, string> {
  const trimmed = raw.trim()
  const stripped = trimmed.startsWith(`${NAMESPACE}.`) ? trimmed.slice(NAMESPACE.length + 1) : trimmed
  return fromSegments(stripped.split("."))
}

export function nameFromPath(directory: string, filepath: string): Result.Result<Name, string> {
  const relative = path.relative(directory, filepath).replaceAll("\\", "/")
  const stripped = relative.replace(/^(?:tool|tools)\//, "")
  if (stripped === relative || !stripped.endsWith(".js")) {
    return Result.fail(`Tool file must live under tool/ or tools/ and end with .js: ${relative}`)
  }
  return fromSegments(stripped.slice(0, -".js".length).split("/"))
}

function fromSegments(segments: ReadonlyArray<string>): Result.Result<Name, string> {
  if (segments.length === 0 || segments.length > MAX_NAME_SEGMENTS) {
    return Result.fail(`Tool name must have 1 to ${MAX_NAME_SEGMENTS} dot-separated segments.`)
  }
  const invalid = segments.find((segment) => !segmentPattern.test(segment))
  if (invalid !== undefined) {
    return Result.fail(
      `Invalid tool name segment ${JSON.stringify(invalid)}: use only letters, digits, underscores, and hyphens.`,
    )
  }
  const name = segments.at(-1)!
  const groups = segments.slice(0, -1)
  const namespace = groups.length === 0 ? NAMESPACE : `${NAMESPACE}.${groups.join(".")}`
  const id = segments.join(".")
  return Result.succeed({
    id,
    name,
    namespace,
    qualified: `${NAMESPACE}.${id}`,
    relativePath: `${segments.join("/")}.js`,
  })
}

export function scanScript(code: string): Result.Result<ScriptScan, string> {
  const scanned = CodeMode.scanProgram(
    code,
    ["fetch", "Bun", "path", "agent", "llm", ...Object.keys(UNAVAILABLE_GLOBALS)],
    ["slice"],
  )
  if (Result.isFailure(scanned)) return Result.fail(`Invalid \`code\`: ${scanned.failure.message}`)
  const unavailable = Object.keys(UNAVAILABLE_GLOBALS).find((name) => scanned.success.globals.has(name))
  if (unavailable !== undefined)
    return Result.fail(
      `Invalid \`code\`: \`${unavailable}\` does not exist in a Code Mode tool script. ${UNAVAILABLE_GLOBALS[unavailable]} Available globals: args, tools, search, fetch, Bun.file, Bun.write, Bun.Glob, path, console.`,
    )
  const forbidden = scanned.success.tools.find((tool) => FORBIDDEN_INNER_TOOLS.has(tool))
  if (forbidden !== undefined) return Result.fail(`Custom tool scripts cannot call ${forbidden}.`)
  const extensions: Array<CodeModeTool.ExtensionName> = []
  if (scanned.success.globals.has("fetch")) extensions.push("fetch")
  if (scanned.success.globals.has("path") || scanned.success.modules.has("path")) extensions.push("path")
  if (scanned.success.globals.has("Bun") || scanned.success.modules.has("bun")) extensions.push("bun")
  if (scanned.success.globals.has("agent") || scanned.success.globals.has("llm")) extensions.push("agents")
  return Result.succeed({
    tools: scanned.success.tools,
    extensions,
  })
}

export function parseDefinition(raw: {
  readonly description: string
  readonly input?: Record<string, Schema.Json>
  readonly output?: Record<string, Schema.Json>
  readonly code: string
}): Result.Result<Definition, string> {
  const description = raw.description.trim()
  if (description.length === 0) return Result.fail("description must be a non-empty string.")

  const inputSchema = (raw.input ?? DEFAULT_INPUT) as JsonSchema.JsonSchema
  if (inputSchema.type !== undefined && inputSchema.type !== "object") {
    return Result.fail('input schema must have type "object" (or omit type).')
  }
  const compiledInput = CodeModeAgents.compile(inputSchema, false)
  if (Result.isFailure(compiledInput)) return Result.fail(`Invalid input schema: ${compiledInput.failure}`)

  const outputSchema = raw.output as JsonSchema.JsonSchema | undefined
  const compiledOutput = outputSchema === undefined ? undefined : CodeModeAgents.compile(outputSchema, false)
  if (compiledOutput !== undefined && Result.isFailure(compiledOutput)) {
    return Result.fail(`Invalid output schema: ${compiledOutput.failure}`)
  }

  const scanned = scanScript(raw.code)
  if (Result.isFailure(scanned)) return Result.fail(scanned.failure)

  return Result.succeed({
    description,
    input: inputSchema,
    ...(outputSchema === undefined ? {} : { output: outputSchema }),
    ...(compiledOutput === undefined ? {} : { compiledOutput: compiledOutput.success }),
    code: raw.code.trim(),
    tools: scanned.success.tools,
    extensions: scanned.success.extensions,
  })
}

export function parseFile(content: string): Result.Result<Definition, string> {
  const extracted = extractHeader(content)
  if (extracted === undefined) {
    return Result.fail("Missing metadata header. Start the .js file with a /*--- ... ---*/ or // --- ... // --- block.")
  }
  const parsed = ConfigMarkdown.parseOption(`---\n${extracted.yaml}\n---\n`)
  if (parsed === undefined) return Result.fail("Invalid YAML in metadata header.")
  const decoded = decodeHeader(parsed.data)
  if (Result.isFailure(decoded)) return Result.fail(`Invalid metadata header: ${formatIssue(decoded.failure.issue)}`)
  return parseDefinition({
    description: decoded.success.description,
    ...(decoded.success.input === undefined ? {} : { input: decoded.success.input }),
    ...(decoded.success.output === undefined ? {} : { output: decoded.success.output }),
    code: extracted.body,
  })
}

export function formatFile(input: {
  readonly description: string
  readonly input?: Record<string, Schema.Json>
  readonly output?: Record<string, Schema.Json>
  readonly code: string
}): string {
  const data: Record<string, unknown> = {
    description: input.description.trim(),
    ...(input.input === undefined ? {} : { input: input.input }),
    ...(input.output === undefined ? {} : { output: input.output }),
  }
  const rendered = matter.stringify("", data)
  const match = rendered.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const yaml = (match ? match[1] : "").trimEnd()
  const header = yaml.includes("*/")
    ? ["// ---", ...yaml.split("\n").map((line) => (line === "" ? "//" : `// ${line}`)), "// ---"].join("\n")
    : `/*---\n${yaml}\n---*/`
  return `${header}\n\n${input.code.trim()}\n`
}

const blockHeaderPattern = /^(?:\uFEFF)?\s*\/\*---[ \t]*\r?\n([\s\S]*?)\r?\n---\*\/[ \t]*(?:\r?\n|$)/

function extractHeader(content: string): { readonly yaml: string; readonly body: string } | undefined {
  const block = content.match(blockHeaderPattern)
  if (block) return { yaml: block[1], body: content.slice(block[0].length) }

  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/)
  let index = 0
  while (index < lines.length && lines[index]!.trim() === "") index++
  if (lines[index]?.trim() !== "// ---") return undefined
  index++
  const yaml: Array<string> = []
  while (index < lines.length) {
    const line = lines[index]!
    const trimmed = line.trim()
    if (trimmed === "// ---") {
      return { yaml: yaml.join("\n"), body: lines.slice(index + 1).join("\n") }
    }
    if (!line.startsWith("//")) return undefined
    yaml.push(line.startsWith("// ") ? line.slice(3) : line.slice(2))
    index++
  }
  return undefined
}
