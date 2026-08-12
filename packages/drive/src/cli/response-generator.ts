import { Backend } from "../client/protocol.js"
import type { JsonValue } from "../project.js"

export const responseTypes = ["text", "reasoning", "tool", "diff"] as const
export type ResponseType = (typeof responseTypes)[number]

export interface ResponseConfiguration {
  readonly types: ReadonlyArray<ResponseType>
  readonly tools: ReadonlyArray<string>
}

export interface ResponseUpdate {
  readonly types?: ReadonlyArray<string>
  readonly tools?: ReadonlyArray<string>
}

const textResponses = [
  "I took a careful look at the problem and followed it through the parts of the system that actually shape the behavior. The result is simpler than it first appeared: one clear boundary, one owner, and fewer opportunities for state to drift. There is a quiet satisfaction in watching the pieces settle into place.",
  "The important path is working now, and the surrounding behavior remains intact. I kept the change focused, made the failure case visible, and checked the point where control passes from one process to another. It is a small adjustment, but it lets a little more daylight into the design.",
  "I traced the request from its first input to its final effect and found the useful seam in between. The implementation now says what it means without asking the reader to remember hidden state. Nothing dramatic happened, which is often the nicest possible ending for this kind of work.",
  "The pieces fit together cleanly after the change. Inputs are handled where they arrive, ownership stays explicit, and cleanup follows the same path every time. The code feels calmer now, like a room after someone has opened a window and put the books back in order.",
  "I checked the current behavior, made the narrow change, and followed it through the edge cases that mattered. The result is direct enough to explain and ordinary enough to trust. Somewhere in the background, the event loop continues its patient little orbit.",
]

const reasoningResponses = [
  "I should inspect the available context before choosing the smallest reliable path through this.",
  "I need to preserve the working behavior while checking the boundary where ownership changes hands.",
  "The request contains enough information to proceed, though the assumptions deserve one careful pass first.",
  "I will separate the observed behavior from the implementation detail, then test the seam between them.",
  "The safest approach is to validate the current state, make one deliberate change, and follow its effects.",
]

export function createResponseSettings() {
  let configuration: ResponseConfiguration = {
    types: ["text", "reasoning", "diff", "tool"],
    tools: ["write", "apply_patch"],
  }
  return {
    current: () => configuration,
    update(input: ResponseUpdate) {
      const updated = {
        types: input.types ? parseTypes(input.types) : configuration.types,
        tools: input.tools ? parseTools(input.tools) : configuration.tools,
      }
      if (
        updated.types.includes("diff") &&
        !updated.tools.includes("*") &&
        !updated.tools.some((tool) => diffTools.has(tool))
      )
        throw new Error(
          "diff responses require apply_patch, write, or edit in --tools",
        )
      configuration = updated
      return configuration
    },
  }
}

export function generateResponse(
  configuration: ResponseConfiguration,
  request: Backend.OpenedExchange,
): {
  readonly items: ReadonlyArray<Backend.Item>
  readonly finish: Backend.FinishReason
} {
  if (hasToolResult(request.body)) return textResponse()
  const tools = offeredTools(request.body).filter(
    (tool) => configuration.tools.includes("*") || configuration.tools.includes(tool.name),
  )
  const available = configuration.types.filter(
    (type) =>
      (type !== "tool" || tools.length > 0) &&
      (type !== "diff" || tools.some((tool) => diffTools.has(tool.name))),
  )
  const type = pick(available)
  if (type === "reasoning")
    return {
      items: [
        { type: "reasoningDelta", text: pick(reasoningResponses) },
        { type: "textDelta", text: pick(textResponses) },
      ],
      finish: "stop",
    }
  if (type === "tool") return toolResponse(tools.slice(0, 3), false)
  if (type === "diff")
    return toolResponse(
      [
        ["apply_patch", "write", "edit"]
          .map((name) => tools.find((tool) => tool.name === name))
          .find((tool) => tool !== undefined)!,
      ],
      true,
    )
  if (type === "text") return textResponse()
  return {
    items: [
      {
        type: "textDelta",
        text: "No configured response type matched the tools offered by this request.",
      },
    ],
    finish: "stop",
  }
}

function textResponse() {
  return {
    items: [{ type: "textDelta" as const, text: pick(textResponses) }],
    finish: "stop" as const,
  }
}

interface ToolDefinition {
  readonly name: string
  readonly parameters: unknown
}

const diffTools = new Set(["apply_patch", "edit", "write"])
let gardenExpanded = false

function toolResponse(tools: ReadonlyArray<ToolDefinition>, diff: boolean) {
  return {
    items: tools.map((tool, index) => ({
      type: "toolCall" as const,
      index,
      id: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      name: tool.name,
      input: toolInput(tool, diff),
    })),
    finish: "tool-calls" as const,
  }
}

function offeredTools(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.tools)) return []
  return body.tools.flatMap((value): ToolDefinition[] => {
    if (!isRecord(value)) return []
    const definition = isRecord(value.function) ? value.function : value
    if (typeof definition.name !== "string") return []
    return [
      {
        name: definition.name,
        parameters: definition.parameters ?? definition.inputSchema,
      },
    ]
  })
}

function toolInput(tool: ToolDefinition, diff: boolean) {
  const generated = schemaValue(tool.parameters, "input")
  const input = isJsonRecord(generated) ? generated : {}
  const known = knownInput(tool.name, diff)
  if (!isRecord(tool.parameters) || !isRecord(tool.parameters.properties))
    return { ...input, ...known }
  const properties = tool.parameters.properties
  return {
    ...input,
    ...Object.fromEntries(
      Object.entries(known).filter(
        ([key, value]) =>
          key in properties && acceptsValue(properties[key], value),
      ),
    ),
  }
}

function knownInput(name: string, diff: boolean): Record<string, JsonValue> {
  const suffix = crypto.randomUUID().slice(0, 8)
  if (name === "apply_patch")
    return {
      patchText: gardenPatch(),
    }
  if (name === "write")
    return {
      path: "src/garden.js",
      filePath: "src/garden.js",
      content:
        'export function greet(name, punctuation = "!") {\n  const visitor = name.trim() || "traveler"\n  return `Hello, ${visitor}${punctuation}`\n}\n',
    }
  if (name === "edit")
    return {
      path: ".opencode/opencode.jsonc",
      filePath: ".opencode/opencode.jsonc",
      oldString: '"name": "Simulation"',
      newString: `"name": "Simulation ${suffix}"`,
    }
  if (name === "read")
    return { path: ".opencode/opencode.jsonc", filePath: ".opencode/opencode.jsonc", offset: 1, limit: 120 }
  if (name === "glob") return { pattern: "**/*", path: ".", limit: 20 }
  if (name === "grep")
    return { pattern: "simulation", path: ".opencode", include: "*.jsonc", limit: 20 }
  if (name === "shell" || name === "bash")
    return { command: diff ? "git diff --stat" : "pwd", description: "Inspect the workspace" }
  return {}
}

function gardenPatch() {
  const patch = gardenExpanded
    ? '*** Begin Patch\n*** Update File: src/garden.js\n@@\n-export function greet(name, punctuation = "!") {\n-  const visitor = name.trim() || "traveler"\n-  return `Hello, ${visitor}${punctuation}`\n+export function greet(name) {\n+  return `Hello, ${name}.`\n }\n*** End Patch'
    : '*** Begin Patch\n*** Update File: src/garden.js\n@@\n-export function greet(name) {\n-  return `Hello, ${name}.`\n+export function greet(name, punctuation = "!") {\n+  const visitor = name.trim() || "traveler"\n+  return `Hello, ${visitor}${punctuation}`\n }\n*** End Patch'
  gardenExpanded = !gardenExpanded
  return patch
}

function schemaValue(
  schema: unknown,
  key: string,
  root: unknown = schema,
): JsonValue {
  if (!isRecord(schema)) return {}
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/$defs/")) {
    const name = schema.$ref.slice("#/$defs/".length)
    if (isRecord(root) && isRecord(root.$defs))
      return schemaValue(root.$defs[name], key, root)
  }
  if ("const" in schema && isJson(schema.const)) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && isJson(schema.enum[0]))
    return schema.enum[0]
  const alternative = Array.isArray(schema.anyOf)
    ? schema.anyOf[0]
    : Array.isArray(schema.oneOf)
      ? schema.oneOf[0]
      : undefined
  if (alternative !== undefined) return schemaValue(alternative, key, root)
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0 && schema.type === undefined)
    return schemaValue(schema.allOf[0], key, root)
  if (schema.type === "object" || isRecord(schema.properties)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : []
    return Object.fromEntries(
      required.map((name) => [name, schemaValue(properties[name], name, root)]),
    )
  }
  if (schema.type === "array") {
    const count = typeof schema.minItems === "number" ? Math.max(1, schema.minItems) : 1
    return Array.from({ length: count }, () => schemaValue(schema.items, key, root))
  }
  if (schema.type === "boolean") return false
  if (schema.type === "integer" || schema.type === "number") {
    if (typeof schema.minimum === "number") return schema.minimum
    if (typeof schema.exclusiveMinimum === "number") return schema.exclusiveMinimum + 1
    return 1
  }
  if (schema.type === "null") return null
  if (key.toLowerCase().includes("path")) return "."
  if (key.toLowerCase().includes("pattern")) return "TODO"
  if (key.toLowerCase().includes("command")) return "pwd"
  if (key.toLowerCase().includes("content")) return "Generated by the simulated model."
  const value = "sample"
  return typeof schema.minLength === "number"
    ? value.padEnd(schema.minLength, "x")
    : value
}

function hasToolResult(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.messages)) return false
  const message = body.messages.at(-1)
  if (!isRecord(message)) return false
  if (message.role === "tool") return true
  if (!Array.isArray(message.content)) return false
  return message.content.some(
    (part) => isRecord(part) && (part.type === "tool-result" || part.type === "tool"),
  )
}

function acceptsValue(schema: unknown, value: JsonValue) {
  if (!isRecord(schema)) return true
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value))
    return false
  if (schema.type === "string") return typeof value === "string"
  if (schema.type === "number" || schema.type === "integer")
    return typeof value === "number"
  if (schema.type === "boolean") return typeof value === "boolean"
  if (schema.type === "array") return Array.isArray(value)
  if (schema.type === "object") return isJsonRecord(value)
  return true
}

function parseTypes(values: ReadonlyArray<string>) {
  const types = unique(values)
  if (types.length === 0) throw new Error("responses requires at least one type")
  const valid = types.filter(isResponseType)
  const unknown = types.filter((value) => !isResponseType(value))
  if (unknown.length > 0)
    throw new Error(`unknown response types: ${unknown.join(", ")}`)
  return valid
}

function parseTools(values: ReadonlyArray<string>) {
  const tools = unique(values)
  if (tools.length === 0) throw new Error("responses requires at least one tool or *")
  if (tools.some((tool) => tool !== "*" && !/^[a-zA-Z0-9_.:-]+$/.test(tool)))
    throw new Error("tool names may contain only letters, numbers, dots, underscores, colons, or dashes")
  return tools
}

function unique(values: ReadonlyArray<string>) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function pick<T>(values: ReadonlyArray<T>) {
  return values[Math.floor(Math.random() * values.length)]!
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonRecord(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJson(value: unknown): value is JsonValue {
  if (value === null) return true
  if (["boolean", "number", "string"].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isJson)
  if (!isRecord(value)) return false
  return Object.values(value).every(isJson)
}

function isResponseType(value: string): value is ResponseType {
  return responseTypes.some((type) => type === value)
}
