#!/usr/bin/env bun

// Writes the `opencode` skill's API reference (`skill://opencode/api.md` and `api/<group>.md`) from the protocol's
// OpenAPI document. Protocol's `bun run generate` runs it after writing openapi.json; `bun run generate:api-skill` from
// packages/core runs it alone. test/opencode-api-skill.test.ts fails when the files are stale.

import fs from "node:fs/promises"
import path from "node:path"

type Schema = {
  readonly $ref?: string
  readonly type?: string | ReadonlyArray<string>
  readonly enum?: ReadonlyArray<unknown>
  readonly const?: unknown
  readonly properties?: Readonly<Record<string, Schema>>
  readonly required?: ReadonlyArray<string>
  readonly items?: Schema
  readonly additionalProperties?: boolean | Schema
  readonly anyOf?: ReadonlyArray<Schema>
  readonly oneOf?: ReadonlyArray<Schema>
  readonly allOf?: ReadonlyArray<Schema>
  readonly description?: string
}

type Parameter = {
  readonly name: string
  readonly in: string
  readonly required?: boolean
  readonly description?: string
  readonly schema?: Schema
}

type Operation = {
  readonly summary?: string
  readonly description?: string
  readonly deprecated?: boolean
  readonly parameters?: ReadonlyArray<Parameter>
  readonly requestBody?: { readonly content?: Readonly<Record<string, { readonly schema?: Schema }>> }
  readonly responses?: Readonly<
    Record<string, { readonly content?: Readonly<Record<string, { readonly schema?: Schema }>> }>
  >
}

type Document = {
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>
  readonly components?: { readonly schemas?: Readonly<Record<string, Schema>> }
}

type Endpoint = {
  readonly method: string
  readonly path: string
  readonly group: string
  readonly experimental: boolean
  readonly operation: Operation
}

// Endpoints the reference documents, as `METHOD /path` with `*` matching anything. Anything not listed, including new
// routes, stays out until it's added here.
const SHOWN = [
  // Sessions: hand work to other sessions, follow it and answer what they ask.
  "GET /api/session",
  "POST /api/session",
  "GET /api/session/active",
  "GET /api/session/{sessionID}",
  "PATCH /api/session/{sessionID}",
  "POST /api/session/{sessionID}/fork",
  "POST /api/session/{sessionID}/agent",
  "POST /api/session/{sessionID}/model",
  "POST /api/session/{sessionID}/prompt",
  "POST /api/session/{sessionID}/command",
  "POST /api/session/{sessionID}/synthetic",
  "POST /api/session/{sessionID}/compact",
  "POST /api/session/{sessionID}/interrupt",
  "POST /api/session/{sessionID}/generate",
  "POST /api/experimental/session/{sessionID}/wait",
  "GET /api/session/{sessionID}/context",
  "GET /api/session/{sessionID}/diff",
  "* /api/session/{sessionID}/inbox*",
  "GET /api/session/{sessionID}/message*",
  "GET /api/session/{sessionID}/form*",
  "POST /api/session/{sessionID}/form/{formID}/reply",
  "GET /api/session/{sessionID}/permission*",
  "GET /api/form",
  "GET /api/permission/request",
  // Scheduling.
  "* /api/experimental/automation*",
  // Where the session is: location, projects, worktrees and version control.
  "* /api/location*",
  "* /api/project*",
  "* /api/worktree*",
  "* /api/vcs*",
  // What's available.
  "GET /api/info",
  "GET /api/agent*",
  "GET /api/command",
  "GET /api/skill",
  "GET /api/model*",
  "GET /api/provider*",
  // Generation, and the stored blobs it returns.
  "* /api/experimental/generate*",
  "GET /api/experimental/blob/*",
]

const INDEX_HEADER = [
  "# OpenCode HTTP API",
  "",
  'Call any endpoint below from Code Mode with `fetch("opencode:///api/...")`. Each group\'s file lists its parameters, bodies and responses.',
  "",
  "- `current` in place of a session ID names the calling session, as in `opencode:///api/session/current`.",
  "- Requests use the session's directory unless the `location[directory]` query or `x-opencode-directory` header sets one.",
  "- Failed requests return a non-2xx status with `{ _tag, message }`.",
  "",
]

const METHODS = ["get", "post", "put", "patch", "delete"]
// Types written out longer than this list only their field names.
const COMPACT = 240

export const directory = path.join(import.meta.dir, "../src/plugin/skill/opencode")

export async function render(): Promise<Record<string, string>> {
  const document: Document = await Bun.file(path.join(import.meta.dir, "../../protocol/openapi.json")).json()
  const schemas = document.components?.schemas ?? {}
  const endpoints = Object.entries(document.paths)
    .filter(([route]) => route.startsWith("/api/"))
    .flatMap(([route, methods]) =>
      METHODS.flatMap((method) => {
        const operation = methods[method]
        const experimental = route.startsWith("/api/experimental/")
        if (!operation || operation.deprecated || !SHOWN.some((pattern) => matches(pattern, `${method.toUpperCase()} ${route}`))) return []
        return [
          {
            method: method.toUpperCase(),
            path: route,
            group: route.slice(experimental ? "/api/experimental/".length : "/api/".length).split("/")[0]!,
            experimental,
            operation,
          },
        ]
      }),
    )
  const groups = Map.groupBy(endpoints, (endpoint) => endpoint.group)
  const names = Array.from(groups.keys()).toSorted()
  const index = [
    ...INDEX_HEADER,
    ...names.flatMap((name) => [
      `## api/${name}.md`,
      "",
      ...groups.get(name)!.map((endpoint) => `- ${heading(endpoint)}: ${endpoint.operation.summary ?? ""}`.trimEnd()),
      "",
    ]),
  ]
  return {
    "api.md": `${index.join("\n").trimEnd()}\n`,
    ...Object.fromEntries(names.map((name) => [`api/${name}.md`, renderGroup(name, groups.get(name)!, schemas)])),
  }
}

function renderGroup(name: string, endpoints: ReadonlyArray<Endpoint>, schemas: Readonly<Record<string, Schema>>) {
  const types = new Set<string>()
  const format = (schema: Schema | undefined) => formatSchema(schema, schemas, types)
  const sections = endpoints.map((endpoint) => {
    const operation = endpoint.operation
    const description = (operation.description ?? operation.summary ?? "").split("Experimental:")[0]!.trim()
    // Path parameters are named in the path itself, so they're listed only when described.
    const parameters = (operation.parameters ?? []).filter(
      (parameter) => parameter.name !== "location" && (parameter.in === "query" || describe(parameter, schemas)),
    )
    const body = operation.requestBody?.content?.["application/json"]?.schema
    const bodyObject = body ? resolve(body, schemas) : undefined
    const required = new Set(bodyObject?.required)
    const fields = Object.entries(bodyObject?.properties ?? {})
    return [
      `## ${heading(endpoint)}`,
      "",
      ...(description ? [description, ""] : []),
      ...(parameters.length > 0
        ? [
            "Parameters:",
            ...parameters.map((parameter) =>
              item(parameter.name, parameter.required ?? false, format(parameter.schema), describe(parameter, schemas)),
            ),
            "",
          ]
        : []),
      ...(fields.length > 0
        ? [
            "Body:",
            ...fields.map(([field, schema]) =>
              item(field, required.has(field), format(schema), describe({ schema }, schemas)),
            ),
            "",
          ]
        : []),
      `Returns: ${returns(operation, format)}`,
    ].join("\n")
  })
  const expanded = expand(types, schemas)
  return [
    `# ${name}`,
    "",
    sections.join("\n\n"),
    ...(expanded.length > 0
      ? [
          "",
          "## Types",
          "",
          ...expanded.map(
            ([type, shape]) =>
              `- \`${type}\`: \`${shape}\`${schemas[type]?.description ? ` ${schemas[type]!.description}` : ""}`,
          ),
        ]
      : []),
    "",
  ].join("\n")
}

function matches(pattern: string, value: string) {
  const parts = pattern.split("*")
  if (parts.length === 1) return pattern === value
  if (!value.startsWith(parts[0]!) || !value.endsWith(parts.at(-1)!)) return false
  return (
    parts.slice(1, -1).reduce<number | undefined>((at, part) => {
      if (at === undefined) return undefined
      const found = value.indexOf(part, at)
      return found === -1 ? undefined : found + part.length
    }, parts[0]!.length) !== undefined
  )
}

function heading(endpoint: Endpoint) {
  return `${endpoint.method} ${endpoint.path}${endpoint.experimental ? " (experimental)" : ""}`
}

function item(name: string, required: boolean, type: string, description: string | undefined) {
  return `- \`${name}${required ? "" : "?"}: ${type}\`${description ? ` ${description}` : ""}`
}

// Aliases of a primitive, such as Session.ID for a string, read better as the primitive.
function alias(schema: Schema) {
  return !schema.$ref && !schema.properties && !schema.items && !schema.anyOf && !schema.oneOf && !schema.allOf
}

// An inlined alias's description, such as steer vs queue on Session.Inbox.Delivery, belongs on the field; other named
// types carry theirs in the Types section.
function describe(
  input: { readonly description?: string; readonly schema?: Schema },
  schemas: Readonly<Record<string, Schema>>,
) {
  const branches = [input.schema, ...(input.schema?.anyOf ?? [])].filter((branch) => branch !== undefined)
  return (
    input.description ??
    branches.map((branch) => branch.description).find(Boolean) ??
    branches
      .map((branch) => (branch.$ref ? schemas[refName(branch.$ref)] : undefined))
      .find((target) => target?.description && alias(target))?.description
  )
}

function returns(operation: Operation, format: (schema: Schema | undefined) => string) {
  const status = Object.keys(operation.responses ?? {})
    .filter((code) => code.startsWith("2"))
    .toSorted()[0]
  const content = status ? operation.responses?.[status]?.content : undefined
  if (!content) return "nothing"
  if ("text/event-stream" in content) return "an event stream"
  const json = content["application/json"]?.schema
  if (json) return `\`${format(json)}\``
  return Object.keys(content)[0] ?? "nothing"
}

// The named types a group mentions, each written out one level deep. Large ones list only their field names.
function expand(types: ReadonlySet<string>, schemas: Readonly<Record<string, Schema>>) {
  const written = new Map<string, string>()
  const pending = Array.from(types)
  while (pending.length > 0) {
    const type = pending.shift()!
    if (written.has(type)) continue
    const nested = new Set<string>()
    const full = formatSchema(schemas[type], schemas, nested, 1)
    const fields = Object.keys(resolve(schemas[type] ?? {}, schemas).properties ?? {})
    const compact = full.length > COMPACT && fields.length > 0
    written.set(type, compact ? `{ ${fields.join(", ")} }` : full)
    if (!compact) pending.push(...nested)
  }
  return Array.from(written).toSorted(([a], [b]) => a.localeCompare(b))
}

function resolve(schema: Schema, schemas: Readonly<Record<string, Schema>>): Schema {
  return schema.$ref ? resolve(schemas[refName(schema.$ref)] ?? {}, schemas) : schema
}

function refName(ref: string) {
  return ref.slice("#/components/schemas/".length)
}

function formatSchema(
  schema: Schema | undefined,
  schemas: Readonly<Record<string, Schema>>,
  types: Set<string>,
  depth = 2,
): string {
  if (!schema) return "unknown"
  if (schema.$ref) {
    const target = schemas[refName(schema.$ref)]
    if (target && alias(target)) return formatSchema(target, schemas, types, depth)
    types.add(refName(schema.$ref))
    return refName(schema.$ref)
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ")
  const union = schema.anyOf ?? schema.oneOf
  // Optional fields are encoded as `T | null`, where the field's `?` already says it can be left out, and numbers
  // also accept the strings "Infinity", "-Infinity" and "NaN", which no caller needs to know.
  if (union)
    return Array.from(
      new Set(
        union
          .filter((branch) => branch.type !== "null" && !branch.enum?.includes("NaN"))
          .map((branch) => formatSchema(branch, schemas, types, depth)),
      ),
    ).join(" | ")
  if (schema.allOf) return schema.allOf.map((branch) => formatSchema(branch, schemas, types, depth)).join(" & ")
  if (Array.isArray(schema.type)) return schema.type.filter((type) => type !== "null").join(" | ")
  if (schema.type === "array") {
    const inner = formatSchema(schema.items, schemas, types, Math.max(0, depth - 1))
    return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`
  }
  if (schema.type === "object" || schema.properties) {
    const fields = Object.entries(schema.properties ?? {})
    if (fields.length === 0)
      return typeof schema.additionalProperties === "object"
        ? `Record<string, ${formatSchema(schema.additionalProperties, schemas, types, Math.max(0, depth - 1))}>`
        : "Record<string, unknown>"
    if (depth <= 0) return `{ ${fields.map(([field]) => field).join(", ")} }`
    const required = new Set(schema.required)
    return `{ ${fields.map(([field, value]) => `${field}${required.has(field) ? "" : "?"}: ${formatSchema(value, schemas, types, depth - 1)}`).join("; ")} }`
  }
  if (schema.type === "integer") return "number"
  return typeof schema.type === "string" ? schema.type : "unknown"
}

if (import.meta.main) {
  const files = await render()
  await fs.rm(path.join(directory, "api"), { recursive: true, force: true })
  await Promise.all(Object.entries(files).map(([file, content]) => Bun.write(path.join(directory, file), content)))
  await Bun.write(
    path.join(directory, "api.ts"),
    [
      '/// <reference path="../../../markdown.d.ts" />',
      "// Generated by script/generate-api-skill.ts.",
      "",
      ...Object.keys(files).map((file, i) => `import file${i} from "./${file}" with { type: "text" }`),
      "",
      "export const files: Record<string, string> = {",
      ...Object.keys(files).map((file, i) => `  ${JSON.stringify(file)}: file${i},`),
      "}",
      "",
    ].join("\n"),
  )
}
