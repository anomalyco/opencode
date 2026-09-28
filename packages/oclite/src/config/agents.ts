import { existsSync } from "fs"
import os from "os"
import path from "path"
import { Result, Schema, SchemaIssue } from "effect"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import type { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { type AgentDef, ConfigError } from "../contract"
import { builtinAgentsDir } from "../util/paths"

// oclite frontmatter extensions; ConfigAgentV1 moves unknown keys into `options`, they are read from there.
const Extensions = Schema.Struct({
  transport: Schema.optional(Schema.Literals(["in-process", "mcp"])),
  mcp: Schema.optional(
    Schema.Struct({ command: Schema.optional(Schema.Array(Schema.String)), url: Schema.optional(Schema.String) }),
  ),
  max_depth: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  read_only: Schema.optional(Schema.Boolean),
  max_context_tokens: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  thinking: Schema.optional(Schema.Literals(["auto", "on", "off"])),
  tools: Schema.optional(Schema.Array(Schema.String)),
})

// Claude Code tool names → oclite tool names (`.claude/agents` tools lists, --allowed-tools).
const CLAUDE_TOOLS: Record<string, string> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  Bash: "bash",
  Grep: "grep",
  Glob: "glob",
  LS: "glob",
  WebFetch: "webfetch",
  Task: "task",
  TodoWrite: "todowrite",
}
// TODO(phase 3): derive from the tool registry instead of repeating the built-in tool names here.
const BUILTIN_TOOLS = ["bash", "edit", "glob", "grep", "question", "read", "skill", "task", "todowrite", "webfetch", "write"]

type Info = ConfigAgentV1.Info
type Entry = { name: string; info: Info; source: string }

export async function loadAgents(input: {
  projectRoot: string
  cwd: string
  home: string
  configDir?: string
  overrides: Record<string, Info>
}): Promise<Record<string, AgentDef>> {
  const root = input.projectRoot
  const layers = [
    { dir: builtinAgentsDir, pattern: "*.md", builtin: true },
    { dir: path.join(input.configDir ?? path.join(input.home, ".config", "oclite"), "agents"), pattern: "**/*.md" },
    { dir: path.join(root, ".claude", "agents"), pattern: "*.md", claude: true },
    { dir: path.join(root, ".opencode"), pattern: "{agent,agents}/**/*.md", prefixes: ["agent/", "agents/"] },
    { dir: path.join(root, ".oclite", "agents"), pattern: "**/*.md" },
  ]
  const files = await Promise.all(layers.map(readLayer))
  const overrides = Object.entries(input.overrides).map(([name, info]) => ({ name, info, source: "config" }))
  const merged = [...files.flat(), ...overrides].reduce<Record<string, Entry>>((result, entry) => {
    const previous = result[entry.name]
    result[entry.name] = previous
      ? { name: entry.name, info: mergeDeep(previous.info, entry.info), source: entry.source }
      : entry
    return result
  }, {})
  return Object.fromEntries(
    Object.values(merged)
      .filter((entry) => !entry.info.disable)
      .map((entry) => [entry.name, toAgentDef(entry)]),
  )
}

async function readLayer(layer: { dir: string; pattern: string; builtin?: boolean; claude?: boolean; prefixes?: string[] }) {
  if (!existsSync(layer.dir)) return []
  const files = (await Array.fromAsync(new Bun.Glob(layer.pattern).scan({ cwd: layer.dir, dot: true }))).sort()
  const entries = await Promise.all(
    files.map(async (relative): Promise<Entry | undefined> => {
      const file = path.join(layer.dir, relative)
      const md = ConfigMarkdown.parseOption(await Bun.file(file).text())
      // .claude files belong to another tool: skip what we can't read instead of failing the whole CLI.
      if (!md && layer.claude) return undefined
      if (!md) throw new ConfigError({ message: `${file}: invalid frontmatter` })
      const data: Record<string, unknown> = { ...md.data }
      const name = typeof data.name === "string" ? data.name : entryName(relative, layer.prefixes ?? [])
      const prompt = md.content.trim()
      const raw = layer.claude ? claudeCompat(data) : moveToolList(data)
      return {
        name,
        info: decode(ConfigAgentV1.Info, { ...raw, ...(prompt ? { prompt } : {}) }, file),
        source: layer.builtin ? "builtin" : file,
      }
    }),
  )
  return entries.filter((entry) => entry !== undefined)
}

function toAgentDef(entry: Entry): AgentDef {
  const info = entry.info
  const ext = decode(Extensions, info.options ?? {}, entry.source)
  return {
    name: entry.name,
    description: info.description,
    mode: info.mode ?? "all",
    prompt: info.prompt,
    model: info.model,
    temperature: info.temperature,
    steps: info.steps,
    permission: fromConfig(info.permission ?? {}),
    options: info.options ?? {},
    source: entry.source,
    transport: ext.transport ?? "in-process",
    mcp: ext.mcp ? { command: ext.mcp.command && [...ext.mcp.command], url: ext.mcp.url } : undefined,
    max_depth: ext.max_depth ?? 2,
    read_only: ext.read_only ?? false,
    max_context_tokens: ext.max_context_tokens,
    thinking: ext.thinking ?? "auto",
    tools: ext.tools && [...ext.tools],
  }
}

// `.claude/agents` compat: a `tools` list only restricts (Claude Code semantics). Every other built-in and every
// unlisted MCP tool is denied; listed tools get no allow rule, so a cloned repo can't grant itself prompt-free
// bash/write. Listed MCP tools get `ask` to re-open them after the `mcp__*` deny. Claude model aliases inherit;
// `color` names are Claude-only.
function claudeCompat(data: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...data }
  delete result.color
  delete result.tools
  if (typeof data.model === "string" && !data.model.includes("/")) delete result.model
  const listed = toolList(data.tools)
  if (!listed) return result
  const tools = listed.map(claudeTool)
  const permission: ConfigPermissionV1.Info = {
    ...Object.fromEntries(BUILTIN_TOOLS.filter((tool) => !tools.includes(tool)).map((tool) => [tool, "deny"])),
    "mcp__*": "deny",
    ...Object.fromEntries(tools.filter((tool) => tool.startsWith("mcp__")).map((tool) => [tool, "ask"])),
  }
  const options = typeof data.options === "object" && data.options !== null ? data.options : {}
  return { ...result, permission, options: { ...options, tools } }
}

// oclite's own `tools: [task, webfetch]` (optional tools for local profiles) is a list, while ConfigAgentV1's
// deprecated `tools` is a record; move lists into options so they decode as the extension.
function moveToolList(data: Record<string, unknown>) {
  if (!Array.isArray(data.tools)) return data
  const result: Record<string, unknown> = { ...data }
  delete result.tools
  const options = typeof data.options === "object" && data.options !== null ? data.options : {}
  return { ...result, options: { ...options, tools: data.tools } }
}

function toolList(value: unknown) {
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean)
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string")
  return undefined
}

export function claudeTool(name: string) {
  return CLAUDE_TOOLS[name] ?? (name.startsWith("mcp__") ? name : name.toLowerCase())
}

function entryName(relative: string, prefixes: string[]) {
  const normalized = relative.replaceAll("\\", "/")
  const stripped = prefixes.find((prefix) => normalized.startsWith(prefix))
  const candidate = stripped ? normalized.slice(stripped.length) : normalized
  return candidate.replace(/\.md$/, "")
}

// Minimal copy of opencode Permission.fromConfig semantics (pattern `~`/`$HOME` expansion). Phase 3 replaces it
// with src/forked/permission-rules.ts.
export function fromConfig(permission: ConfigPermissionV1.Info): PermissionV1.Rule[] {
  return Object.entries(permission).flatMap(([key, value]): PermissionV1.Rule[] => {
    if (value === undefined) return []
    if (typeof value === "string") return [{ permission: key, pattern: "*", action: value }]
    return Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action }))
  })
}

function expand(pattern: string) {
  if (pattern === "~" || pattern === "$HOME") return os.homedir()
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function decode<S extends Schema.Decoder<unknown>>(schema: S, value: unknown, source: string): S["Type"] {
  const result = Schema.decodeUnknownResult(schema)(value, {
    errors: "all",
    onExcessProperty: "ignore",
    propertyOrder: "original",
  })
  if (Result.isFailure(result)) throw new ConfigError({ message: `${source}: ${describeIssues(result.failure.issue)}` })
  return result.success
}

// Path + expected type only. Effect's own message embeds the offending input ("…, got {…}"), which can carry
// API keys or Authorization headers, so the actual value is never printed.
function describeIssues(issue: SchemaIssue.Issue) {
  return SchemaIssue.makeFormatterStandardSchemaV1()(issue)
    .issues.map((item) => {
      const where = item.path?.length ? ` at ${item.path.map((part) => (typeof part === "object" ? String(part.key) : String(part))).join(".")}` : ""
      return `${item.message.replace(/, got [\s\S]*$/, "")}${where}`
    })
    .join("; ")
}

/** Plain objects merge recursively; anything else (arrays included) is replaced by the later value. */
export function mergeDeep<T>(base: T, next: T): T {
  if (!isPlainObject(base) || !isPlainObject(next)) return next === undefined ? base : next
  const keys = [...new Set([...Object.keys(base), ...Object.keys(next)])]
  return Object.fromEntries(keys.map((key) => [key, mergeDeep(base[key], next[key])])) as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
