#!/usr/bin/env bun

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

type JsonSchema = {
  readonly $ref?: string
  readonly type?: string | ReadonlyArray<string>
  readonly enum?: ReadonlyArray<unknown>
  readonly const?: unknown
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: ReadonlyArray<string>
  readonly items?: JsonSchema
  readonly additionalProperties?: boolean | JsonSchema
  readonly anyOf?: ReadonlyArray<JsonSchema>
  readonly oneOf?: ReadonlyArray<JsonSchema>
  readonly allOf?: ReadonlyArray<JsonSchema>
  readonly description?: string
}

type Parameter = {
  readonly name: string
  readonly in: string
  readonly required?: boolean
  readonly schema?: JsonSchema
  readonly description?: string
}

type MediaObject = {
  readonly schema?: JsonSchema
}

type Operation = {
  readonly tags?: ReadonlyArray<string>
  readonly operationId?: string
  readonly summary?: string
  readonly description?: string
  readonly parameters?: ReadonlyArray<Parameter>
  readonly requestBody?: {
    readonly required?: boolean
    readonly content?: Readonly<Record<string, MediaObject>>
  }
  readonly responses?: Readonly<
    Record<
      string,
      {
        readonly description?: string
        readonly content?: Readonly<Record<string, MediaObject>>
      }
    >
  >
}

type OpenApiDocument = {
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>
  readonly components?: {
    readonly schemas?: Readonly<Record<string, JsonSchema>>
  }
}

type Entry = {
  readonly method: string
  readonly path: string
  readonly tag: string
  readonly operationId: string
  readonly operation: Operation
}

type Topic = {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly tags: ReadonlyArray<string>
}

const TOPICS: ReadonlyArray<Topic> = [
  {
    id: "sessions",
    title: "Sessions, Messages & Forms",
    summary:
      "Create, list, prompt, wait, interrupt, fork, revert, and inspect sessions, messages, inbox, and pending forms/permissions.",
    tags: ["session", "message", "permission", "form"],
  },
  {
    id: "workspace",
    title: "Workspace, Projects & VCS",
    summary: "Inspect the current location, projects, git worktrees, VCS status/diffs/branches, and references.",
    tags: ["location", "project", "worktree", "vcs", "reference"],
  },
  {
    id: "models",
    title: "Models, Providers & Generation",
    summary:
      "List models, providers, usage limits, and invoke text, image, video, decision, or voice generation endpoints.",
    tags: ["model", "provider", "usage", "generate", "voice"],
  },
  {
    id: "extensions",
    title: "Agents, Skills, Plugins & MCP",
    summary:
      "Inspect agents, commands, skills, plugins, MCP servers/resources, integrations, RPC methods, and websearch providers.",
    tags: ["agent", "command", "skill", "plugin", "mcp", "integration", "rpc", "websearch"],
  },
  {
    id: "runtime",
    title: "Runtime, Jobs, Automations & Artifacts",
    summary:
      "Server info, read-only config, background shells/jobs, automations, artifacts, blobs/media, SSE events, debug, and migration status.",
    tags: ["server", "config", "shell", "experimental", "event", "debug", "migration", "persistentPty"],
  },
]

const METHODS = ["get", "post", "put", "patch", "delete"] as const

const coreDir = fileURLToPath(new URL("..", import.meta.url))
const repoRoot = path.resolve(coreDir, "../..")
const openApiPath = path.join(repoRoot, "packages/protocol/openapi.json")
const outputDir = path.join(coreDir, "src/plugin/skill/opencode/api")
const manifestPath = path.join(coreDir, "src/plugin/skill/opencode/api.ts")

export async function renderApiSkillFiles() {
  const spec = (await Bun.file(openApiPath).json()) as OpenApiDocument
  const schemas = spec.components?.schemas ?? {}

  const entries: Array<Entry> = []
  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = methods[method]
      if (!operation) continue
      const upper = method.toUpperCase()
      entries.push({
        method: upper,
        path: routePath,
        tag: operation.tags?.[0] ?? "runtime",
        operationId: operation.operationId ?? `${upper} ${routePath}`,
        operation,
      })
    }
  }

  const byTopic = new Map<string, Array<Entry>>(TOPICS.map((topic) => [topic.id, []]))
  const tagToTopic = new Map<string, string>()
  for (const topic of TOPICS) {
    for (const tag of topic.tags) tagToTopic.set(tag, topic.id)
  }
  for (const entry of entries) {
    const topicID = tagToTopic.get(entry.tag) ?? "runtime"
    byTopic.get(topicID)!.push(entry)
  }

  const files: Record<string, string> = {}

  const indexLines: Array<string> = [
    "# OpenCode API Reference Index",
    "",
    "Generated from the OpenCode OpenAPI contract.",
    "Requests to `opencode:///api/...` default `x-opencode-directory` to the current session directory unless overridden.",
    "",
    "## Reference Files",
    "",
  ]

  for (const topic of TOPICS) {
    const group = byTopic.get(topic.id) ?? []
    if (group.length === 0) continue
    const fileKey = `api/${topic.id}.md`
    indexLines.push(`### \`skill://opencode/${fileKey}\` — ${topic.title} (${group.length})`)
    indexLines.push("")
    indexLines.push(topic.summary)
    indexLines.push("")
    for (const item of group) {
      const summary = item.operation.summary ? ` — ${item.operation.summary}` : ""
      indexLines.push(`- \`${item.method} ${item.path}\`${summary}`)
    }
    indexLines.push("")
    files[fileKey] = renderTopic(topic, group, schemas)
  }

  files["api/index.md"] = `${indexLines.join("\n").trimEnd()}\n`
  return files
}

function renderTopic(topic: Topic, entries: ReadonlyArray<Entry>, schemas: Readonly<Record<string, JsonSchema>>) {
  const referenced = new Set<string>()
  const lines: Array<string> = [`# ${topic.title}`, "", topic.summary, ""]

  for (const entry of entries) {
    const { operation } = entry
    lines.push(`## \`${entry.method} ${entry.path}\``)
    const headline = operation.summary ?? operation.operationId
    const desc = cleanDescription(operation.description)
    if (headline && desc && desc !== headline) lines.push(`${headline}. ${desc}`)
    else if (desc) lines.push(desc)
    else if (headline) lines.push(headline)

    const queryParams = (operation.parameters ?? []).filter(
      (param) => param.in === "query" && param.name !== "location",
    )
    if (queryParams.length > 0) {
      const rendered = queryParams.map((param) => {
        const type = formatSchema(param.schema, schemas, referenced, 1)
        const opt = param.required ? "" : "?"
        return `\`${param.name}${opt}: ${type}\``
      })
      lines.push(`- Query: ${rendered.join(", ")}`)
    }

    const bodySchema = operation.requestBody?.content?.["application/json"]?.schema
    if (bodySchema) {
      lines.push(`- Body: \`${formatSchema(bodySchema, schemas, referenced, 2)}\``)
    }

    const success = renderSuccessResponse(operation.responses, schemas, referenced)
    if (success) lines.push(`- Returns: ${success}`)
    lines.push("")
  }

  const expandedTypes = collectTypes(referenced, schemas)
  if (expandedTypes.length > 0) {
    lines.push("## Types", "")
    for (const [name, shape] of expandedTypes) {
      lines.push(`- \`${name}\`: \`${shape}\``)
    }
    lines.push("")
  }

  return `${lines.join("\n").trimEnd()}\n`
}

function renderSuccessResponse(
  responses: Operation["responses"],
  schemas: Readonly<Record<string, JsonSchema>>,
  referenced: Set<string>,
) {
  if (!responses) return undefined
  const status = Object.keys(responses)
    .filter((code) => code.startsWith("2"))
    .toSorted()[0]
  if (!status) return undefined
  const response = responses[status]
  if (status === "204" || !response?.content) return `${status} No Content`
  if ("text/event-stream" in response.content) {
    const schema = response.content["text/event-stream"]?.schema
    return schema ? `${status} SSE \`${formatSchema(schema, schemas, referenced, 1)}\`` : `${status} SSE`
  }
  const json = response.content["application/json"]?.schema
  if (json) return `${status} \`${formatSchema(json, schemas, referenced, 2)}\``
  const media = Object.keys(response.content)[0]
  return media ? `${status} ${media}` : status
}

function collectTypes(initial: ReadonlySet<string>, schemas: Readonly<Record<string, JsonSchema>>) {
  const result: Array<[string, string]> = []
  const visited = new Set<string>()
  const queue = Array.from(initial).toSorted()
  // Expand referenced types one hop so agents see field shapes without exploding file size.
  for (const name of queue) {
    if (visited.has(name)) continue
    visited.add(name)
    const schema = schemas[name]
    if (!schema) continue
    const ignored = new Set<string>()
    const rendered = formatSchema(schema, schemas, ignored, 1)
    if (rendered === "string" || rendered === "number" || rendered === "boolean") continue
    result.push([name, rendered])
  }
  return result
}

function refName(ref: string) {
  const prefix = "#/components/schemas/"
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref
}

function formatSchema(
  schema: JsonSchema | undefined,
  schemas: Readonly<Record<string, JsonSchema>>,
  referenced: Set<string>,
  depth: number,
): string {
  if (!schema) return "unknown"
  if (schema.$ref) {
    const name = refName(schema.$ref)
    const target = schemas[name]
    // Inline simple primitive aliases (like Session.ID -> string) to keep output concise.
    if (
      target &&
      !target.$ref &&
      !target.properties &&
      !target.items &&
      !target.anyOf &&
      !target.oneOf &&
      !target.allOf
    ) {
      if (target.enum) return target.enum.map((item) => JSON.stringify(item)).join(" | ")
      if (target.const !== undefined) return JSON.stringify(target.const)
      if (typeof target.type === "string" && target.type !== "object" && target.type !== "array") return target.type
    }
    referenced.add(name)
    return name
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.enum) return schema.enum.map((item) => JSON.stringify(item)).join(" | ")
  if (schema.anyOf) return dedupeUnion(schema.anyOf.map((branch) => formatSchema(branch, schemas, referenced, depth)))
  if (schema.oneOf) return dedupeUnion(schema.oneOf.map((branch) => formatSchema(branch, schemas, referenced, depth)))
  if (schema.allOf) return schema.allOf.map((branch) => formatSchema(branch, schemas, referenced, depth)).join(" & ")
  if (Array.isArray(schema.type)) return dedupeUnion(schema.type)
  if (schema.type === "array") {
    const inner = formatSchema(schema.items, schemas, referenced, Math.max(0, depth - 1))
    return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`
  }
  if (schema.type === "object" || schema.properties) {
    const entries = Object.entries(schema.properties ?? {})
    if (entries.length === 0) {
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        const value = formatSchema(schema.additionalProperties, schemas, referenced, Math.max(0, depth - 1))
        return `Record<string, ${value}>`
      }
      return "Record<string, unknown>"
    }
    if (depth <= 0) return `{ ${entries.map(([key]) => key).join(", ")} }`
    const required = new Set(schema.required ?? [])
    const fields = entries.map(([key, prop]) => {
      const opt = required.has(key) ? "" : "?"
      return `${key}${opt}: ${formatSchema(prop, schemas, referenced, depth - 1)}`
    })
    return `{ ${fields.join("; ")} }`
  }
  if (schema.type === "integer") return "number"
  return typeof schema.type === "string" ? schema.type : "unknown"
}

function dedupeUnion(parts: ReadonlyArray<string>) {
  return Array.from(new Set(parts)).join(" | ")
}

function cleanDescription(text: string | undefined) {
  if (!text) return undefined
  return text.replace(/\s+/g, " ").trim()
}

export function renderManifest(files: Readonly<Record<string, string>>) {
  const keys = Object.keys(files).toSorted()
  const imports = keys.map((key) => {
    const ident = key
      .replace(/^api\//, "")
      .replace(/\.md$/, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
    return `import ${ident} from "./${key}" with { type: "text" }`
  })
  const entries = keys.map((key) => {
    const ident = key
      .replace(/^api\//, "")
      .replace(/\.md$/, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
    return `  ${JSON.stringify(key)}: ${ident},`
  })
  return [
    '/// <reference path="../../../markdown.d.ts" />',
    "// Generated by packages/core/script/generate-api-skill.ts. Do not edit by hand.",
    "",
    ...imports,
    "",
    "export const opencodeApiFiles: Readonly<Record<string, string>> = {",
    ...entries,
    "}",
    "",
  ].join("\n")
}

async function main() {
  const files = await renderApiSkillFiles()
  const manifest = renderManifest(files)
  const check = process.argv.includes("--check")

  if (check) {
    const existing = await fs
      .readdir(outputDir)
      .then((names) => names.filter((name) => name.endsWith(".md")).map((name) => `api/${name}`))
      .catch(() => [] as Array<string>)
    const expected = Object.keys(files).toSorted()
    const mismatches: Array<string> = []
    for (const extra of existing.filter((key) => !(key in files))) mismatches.push(`extra file: ${extra}`)
    for (const key of expected) {
      const fullPath = path.join(coreDir, "src/plugin/skill/opencode", key)
      const current = await Bun.file(fullPath)
        .text()
        .catch(() => undefined)
      if (current !== files[key]) mismatches.push(`stale file: ${key}`)
    }
    const currentManifest = await Bun.file(manifestPath)
      .text()
      .catch(() => undefined)
    if (currentManifest !== manifest) mismatches.push("stale manifest: api.ts")
    if (mismatches.length > 0) {
      console.error(
        `Generated OpenCode API skill files are out of date (${mismatches.join(", ")}). Run \`bun run generate:api-skill\` from packages/core.`,
      )
      process.exit(1)
    }
    process.exit(0)
  }

  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })
  for (const [key, content] of Object.entries(files)) {
    await Bun.write(path.join(coreDir, "src/plugin/skill/opencode", key), content)
  }
  await Bun.write(manifestPath, manifest)
}

if (import.meta.main) {
  await main()
}
