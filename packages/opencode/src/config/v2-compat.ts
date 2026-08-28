export * as ConfigV2Compat from "./v2-compat"

import { isDeepStrictEqual } from "node:util"
import { Option, Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { ConfigAttachmentV1 } from "@opencode-ai/core/v1/config/attachment"
import { ConfigLSPV1 } from "@opencode-ai/core/v1/config/lsp"
import { InvalidError } from "@opencode-ai/core/v1/config/error"

export interface Diagnostic {
  readonly kind: "invalid" | "unsupported" | "conflict"
  readonly path: readonly string[]
  readonly message: string
}

export interface Result {
  readonly value: unknown
  readonly diagnostics: readonly Diagnostic[]
}

const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const
const Record = Schema.Record(Schema.String, Schema.Unknown)
const Timeout = Schema.Struct({
  startup: Schema.optional(PositiveInt),
  catalog: Schema.optional(PositiveInt),
  execution: Schema.optional(PositiveInt),
})
const OAuth = Schema.Struct({
  client_id: Schema.optional(Schema.String),
  client_secret: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  callback_port: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
  redirect_uri: Schema.optional(Schema.String),
})
const Server = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("local"),
    command: Schema.Array(Schema.String),
    cwd: Schema.optional(Schema.String),
    environment: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    disabled: Schema.optional(Schema.Boolean),
    codemode: Schema.optional(Schema.Boolean),
    timeout: Schema.optional(Timeout),
  }),
  Schema.Struct({
    type: Schema.Literal("remote"),
    url: Schema.String,
    headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])),
    disabled: Schema.optional(Schema.Boolean),
    codemode: Schema.optional(Schema.Boolean),
    timeout: Schema.optional(Timeout),
  }),
])
const Selection = Schema.Union([
  Schema.String.check(Schema.isPattern(/^[^/#]+\/[^#]+(?:#[^#]+)?$/)),
  Schema.Struct({
    providerID: Schema.String.check(Schema.isPattern(/^[^/#]+$/)),
    model: Schema.String.check(Schema.isPattern(/^[^#]+$/)),
    variant: Schema.optional(Schema.String.check(Schema.isPattern(/^[^#]+$/))),
  }),
])
const Agent = Schema.Struct({
  model: Schema.optional(Selection),
  request: Schema.optional(
    Schema.Struct({
      headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      body: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
    }),
  ),
  system: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Literals(["subagent", "primary", "all"])),
  hidden: Schema.optional(Schema.Boolean),
  color: Schema.optional(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
  steps: Schema.optional(PositiveInt),
  disabled: Schema.optional(Schema.Boolean),
})
const Command = Schema.Struct({
  template: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Selection),
  subtask: Schema.optional(Schema.Boolean),
})

const decodeRecord = Schema.decodeUnknownOption(Record, decodeOptions)
const decodeLspEntry = Schema.decodeUnknownOption(ConfigLSPV1.Entry, decodeOptions)
const builtinServers = new Set<string>(ConfigLSPV1.builtinServerIds)

export function lower(input: unknown, source = "configuration"): Result {
  const parsed = decodeRecord(input)
  if (Option.isNone(parsed)) return { value: input, diagnostics: [] }

  const permissions = [
    ...(Object.hasOwn(parsed.value, "permissions") ? [["permissions"]] : []),
    ...["agents", "agent", "mode"].flatMap((key) => {
      const agents = decodeRecord(parsed.value[key])
      if (Option.isNone(agents)) return []
      return Object.entries(agents.value).flatMap(([name, value]) => {
        const agent = decodeRecord(value)
        return Option.isSome(agent) && Object.hasOwn(agent.value, "permissions") ? [[key, name, "permissions"]] : []
      })
    }),
  ]
  if (permissions.length)
    throw new InvalidError({
      path: source,
      issues: permissions.map((path) => ({
        path,
        message: 'V2 permissions are not supported by OpenCode V1. Use V1 "permission" rules or run opencode2.',
      })),
    })

  const result: Record<string, unknown> = { ...parsed.value }
  const diagnostics: Diagnostic[] = []
  for (const key of ["plugins", "providers", "websearch", "warming"])
    if (Object.hasOwn(parsed.value, key)) unsupported([key], diagnostics)

  normalizeSettings(parsed.value, result, diagnostics)
  normalizeModel(parsed.value, result, diagnostics)
  normalizeSkills(parsed.value, result, diagnostics)
  normalizeCompaction(parsed.value, result, diagnostics)
  normalizeExperimental(parsed.value, result, diagnostics)

  normalizeAgents(parsed.value, result, diagnostics)
  normalizeCommands(parsed.value, result, diagnostics)
  normalizeMcp(parsed.value, result, diagnostics)
  normalizeLsp(parsed.value, result, diagnostics)

  return { value: result, diagnostics }
}

function normalizeSettings(input: Record<string, unknown>, result: Record<string, unknown>, diagnostics: Diagnostic[]) {
  if (Object.hasOwn(input, "snapshots")) {
    const value = decodeValue(Schema.Boolean, input.snapshots, ["snapshots"], diagnostics)
    if (value !== undefined) preferLegacy(result, "snapshot", value, ["snapshots"], diagnostics)
  }
  if (Object.hasOwn(input, "media")) {
    const value = decodeValue(ConfigAttachmentV1.Info, input.media, ["media"], diagnostics)
    if (value !== undefined) preferLegacy(result, "attachment", value, ["media"], diagnostics)
  }
}

function normalizeModel(input: Record<string, unknown>, result: Record<string, unknown>, diagnostics: Diagnostic[]) {
  if (!Object.hasOwn(input, "model")) return
  const selection = Schema.decodeUnknownOption(Selection, decodeOptions)(input.model)
  if (Option.isNone(selection)) return
  const value = lowerSelection(selection.value)
  result.model = value.model
  if (value.variant !== undefined) unsupported(["model", "variant"], diagnostics)
}

function normalizeSkills(input: Record<string, unknown>, result: Record<string, unknown>, diagnostics: Diagnostic[]) {
  if (!Array.isArray(input.skills)) return
  const skills = decodeValue(Schema.Array(Schema.String), input.skills, ["skills"], diagnostics)
  if (skills === undefined) return
  result.skills = {
    paths: skills.filter((value) => !/^https?:\/\//i.test(value)),
    urls: skills.filter((value) => /^https?:\/\//i.test(value)),
  }
}

function normalizeCompaction(
  input: Record<string, unknown>,
  result: Record<string, unknown>,
  diagnostics: Diagnostic[],
) {
  const compaction = decodeRecord(input.compaction)
  if (Option.isNone(compaction)) return
  const value = { ...compaction.value }
  if (Object.hasOwn(value, "keep")) {
    const keep = decodeValue(Record, value.keep, ["compaction", "keep"], diagnostics)
    if (keep !== undefined && Object.hasOwn(keep, "tokens")) {
      const tokens = decodeValue(NonNegativeInt, keep.tokens, ["compaction", "keep", "tokens"], diagnostics)
      if (tokens !== undefined)
        preferLegacy(value, "preserve_recent_tokens", tokens, ["compaction", "keep", "tokens"], diagnostics)
    }
  }
  if (Object.hasOwn(value, "buffer")) {
    const buffer = decodeValue(NonNegativeInt, value.buffer, ["compaction", "buffer"], diagnostics)
    if (buffer !== undefined) preferLegacy(value, "reserved", buffer, ["compaction", "buffer"], diagnostics)
  }
  result.compaction = value
}

function normalizeExperimental(
  input: Record<string, unknown>,
  result: Record<string, unknown>,
  diagnostics: Diagnostic[],
) {
  const experimental = decodeRecord(input.experimental)
  if (Option.isNone(experimental)) return
  if (Object.hasOwn(experimental.value, "portable_shell_scanner"))
    unsupported(["experimental", "portable_shell_scanner"], diagnostics)
  if (!Object.hasOwn(experimental.value, "subagent_depth")) return
  const depth = decodeValue(
    NonNegativeInt,
    experimental.value.subagent_depth,
    ["experimental", "subagent_depth"],
    diagnostics,
  )
  if (depth !== undefined)
    preferLegacy(result, "subagent_depth", depth, ["experimental", "subagent_depth"], diagnostics)
}

function normalizeAgents(input: Record<string, unknown>, result: Record<string, unknown>, diagnostics: Diagnostic[]) {
  if (!Object.hasOwn(input, "agents")) return
  const agents = decodeValue(Record, input.agents, ["agents"], diagnostics)
  if (agents === undefined) return
  const legacy = decodeRecord(result.agent)
  const merged: Record<string, unknown> = Option.isSome(legacy) ? { ...legacy.value } : {}
  for (const [name, value] of Object.entries(agents)) {
    const path = ["agents", name]
    if (Object.hasOwn(merged, name)) {
      if (!isDeepStrictEqual(merged[name], value)) conflict(path, diagnostics)
      continue
    }
    const parsed = decodeValue(Agent, value, path, diagnostics)
    if (parsed === undefined) continue
    if (parsed.request?.headers !== undefined) unsupported([...path, "request", "headers"], diagnostics)
    setOwn(merged, name, lowerAgent(parsed))
  }
  if (Object.hasOwn(result, "agent") && Option.isNone(legacy)) return
  if (Object.keys(merged).length > 0 || Option.isSome(legacy)) result.agent = merged
}

function normalizeCommands(input: Record<string, unknown>, result: Record<string, unknown>, diagnostics: Diagnostic[]) {
  if (!Object.hasOwn(input, "commands")) return
  const commands = decodeValue(Record, input.commands, ["commands"], diagnostics)
  if (commands === undefined) return
  const legacy = decodeRecord(result.command)
  if (Object.hasOwn(result, "command") && Option.isNone(legacy)) return
  const merged: Record<string, unknown> = Option.isSome(legacy) ? { ...legacy.value } : {}
  for (const [name, value] of Object.entries(commands)) {
    const path = ["commands", name]
    const parsed = decodeValue(Command, value, path, diagnostics)
    if (parsed === undefined) continue
    preferLegacy(merged, name, lowerCommand(parsed), path, diagnostics)
  }
  if (Object.keys(merged).length > 0 || Option.isSome(legacy)) result.command = merged
}

function normalizeMcp(input: Record<string, unknown>, result: Record<string, unknown>, diagnostics: Diagnostic[]) {
  const mcp = decodeRecord(input.mcp)
  if (Option.isNone(mcp)) return
  const servers: Record<string, unknown> = {}
  const nested = decodeRecord(mcp.value.servers)
  const envelope = Option.isSome(nested) && !isDirectServer(nested.value)
  const timeoutRecord = decodeRecord(mcp.value.timeout)
  const timeout = Schema.decodeUnknownOption(Timeout, decodeOptions)(mcp.value.timeout)
  const globalTimeout =
    Option.isSome(timeout) &&
    Option.isSome(timeoutRecord) &&
    !isDirectServer(timeoutRecord.value) &&
    (Object.keys(timeoutRecord.value).length === 0 ||
      ["startup", "catalog", "execution"].some((key) => Object.hasOwn(timeoutRecord.value, key)))

  for (const [name, value] of Object.entries(mcp.value)) {
    if (name === "servers" && envelope) continue
    if (name === "timeout" && globalTimeout) continue
    const path = ["mcp", name]
    const record = decodeRecord(value)
    const oauth = Option.isSome(record) ? decodeRecord(record.value.oauth) : Option.none()
    const native =
      Option.isSome(record) &&
      (Object.hasOwn(record.value, "disabled") ||
        Object.hasOwn(record.value, "codemode") ||
        typeof record.value.timeout === "object" ||
        (Option.isSome(oauth) &&
          ["client_id", "client_secret", "callback_port", "redirect_uri"].some((key) =>
            Object.hasOwn(oauth.value, key),
          )))
    // Keep invalid flat entries for the final V1 decoder rather than sanitizing them.
    setOwn(servers, name, native ? (normalizeServer(value, path, diagnostics) ?? value) : value)
  }

  if (envelope && Option.isSome(nested)) {
    for (const [name, value] of Object.entries(nested.value)) {
      const path = ["mcp", "servers", name]
      if (Object.hasOwn(servers, name)) {
        if (!isDeepStrictEqual(servers[name], value)) conflict(path, diagnostics)
        continue
      }
      const record = decodeRecord(value)
      if (
        Option.isSome(record) &&
        typeof record.value.enabled === "boolean" &&
        !Object.hasOwn(record.value, "disabled")
      ) {
        setOwn(servers, name, value)
        continue
      }
      const server = normalizeServer(value, path, diagnostics)
      if (server !== undefined) setOwn(servers, name, server)
    }
  }
  result.mcp = servers

  if (!globalTimeout || Option.isNone(timeout)) return
  const value = lowerTimeout(timeout.value)
  if (value === undefined) {
    if (Object.keys(timeout.value).length) unsupported(["mcp", "timeout"], diagnostics)
    return
  }
  const existing = decodeRecord(result.experimental)
  if (Object.hasOwn(result, "experimental") && Option.isNone(existing)) return
  const experimental = Option.isSome(existing) ? { ...existing.value } : {}
  preferLegacy(experimental, "mcp_timeout", value, ["mcp", "timeout"], diagnostics)
  result.experimental = experimental
}

function isDirectServer(value: Record<string, unknown>) {
  // Object-valued entries can be servers literally named "type" or "enabled".
  return ["type", "enabled"].some(
    (key) =>
      Object.hasOwn(value, key) && (value[key] === null || typeof value[key] !== "object" || Array.isArray(value[key])),
  )
}

function normalizeServer(input: unknown, path: string[], diagnostics: Diagnostic[]) {
  const server = decodeValue(Server, input, path, diagnostics)
  if (server === undefined) return
  if (server.codemode !== undefined) unsupported([...path, "codemode"], diagnostics)
  if (server.timeout && lowerTimeout(server.timeout) === undefined && Object.keys(server.timeout).length)
    unsupported([...path, "timeout"], diagnostics)
  const raw = decodeRecord(input)
  if (Option.isNone(raw) || !Object.hasOwn(raw.value, "enabled")) return lowerServer(server)
  if (server.disabled !== undefined && raw.value.enabled === server.disabled)
    conflict([...path, "disabled"], diagnostics)
  return { ...lowerServer(server), enabled: raw.value.enabled }
}

function normalizeLsp(input: Record<string, unknown>, result: Record<string, unknown>, diagnostics: Diagnostic[]) {
  const lsp = decodeRecord(input.lsp)
  if (Option.isNone(lsp)) return
  result.lsp = Object.fromEntries(
    Object.entries(lsp.value).filter(([name, value]) => {
      if (builtinServers.has(name)) return true
      const entry = decodeLspEntry(value)
      if (Option.isNone(entry)) return true
      if (entry.value.disabled === true) return true
      if ("extensions" in entry.value && entry.value.extensions !== undefined) return true
      unsupported(["lsp", name], diagnostics)
      return false
    }),
  )
}

function lowerSelection(input: Schema.Schema.Type<typeof Selection>) {
  if (typeof input !== "string") {
    return {
      model: `${input.providerID}/${input.model}`,
      ...(input.variant !== undefined ? { variant: input.variant } : {}),
    }
  }
  const index = input.indexOf("#")
  if (index === -1) return { model: input }
  return { model: input.slice(0, index), variant: input.slice(index + 1) }
}

function lowerTimeout(input: Schema.Schema.Type<typeof Timeout>) {
  if (input.startup !== undefined) return undefined
  if (input.catalog === undefined || input.execution === undefined) return undefined
  if (input.catalog !== input.execution) return undefined
  return input.catalog
}

function lowerServer(input: Schema.Schema.Type<typeof Server>) {
  const result: Record<string, unknown> = {
    ...input,
    enabled: input.disabled !== true,
  }
  delete result.disabled
  delete result.codemode
  delete result.timeout

  if (input.timeout) {
    const timeout = lowerTimeout(input.timeout)
    if (timeout !== undefined) result.timeout = timeout
  }

  if (input.type === "remote" && input.oauth && typeof input.oauth === "object") {
    const oauth: Record<string, unknown> = {}
    if (input.oauth.client_id !== undefined) oauth.clientId = input.oauth.client_id
    if (input.oauth.client_secret !== undefined) oauth.clientSecret = input.oauth.client_secret
    if (input.oauth.scope !== undefined) oauth.scope = input.oauth.scope
    if (input.oauth.callback_port !== undefined) oauth.callbackPort = input.oauth.callback_port
    if (input.oauth.redirect_uri !== undefined) oauth.redirectUri = input.oauth.redirect_uri
    result.oauth = oauth
  }

  return result
}

function lowerAgent(input: Schema.Schema.Type<typeof Agent>) {
  const result: Record<string, unknown> = {}
  for (const key of ["description", "mode", "hidden", "color", "steps"] as const) {
    if (input[key] !== undefined) result[key] = input[key]
  }
  if (input.system !== undefined) result.prompt = input.system
  if (input.disabled !== undefined) result.disable = input.disabled
  if (input.model !== undefined) Object.assign(result, lowerSelection(input.model))
  if (input.request?.body !== undefined) result.options = input.request.body

  return result
}

function lowerCommand(input: Schema.Schema.Type<typeof Command>) {
  return { ...input, ...(input.model !== undefined ? lowerSelection(input.model) : {}) }
}

function decodeValue<S extends Schema.Codec<unknown, unknown, never, never>>(
  schema: S,
  value: unknown,
  path: string[],
  diagnostics: Diagnostic[],
) {
  const decoded = Schema.decodeUnknownOption(schema, decodeOptions)(value)
  if (Option.isSome(decoded)) return decoded.value
  diagnostics.push({ kind: "invalid", path, message: "Native setting could not be lowered because it is malformed" })
  return undefined
}

function preferLegacy(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  path: string[],
  diagnostics: Diagnostic[],
) {
  if (Object.hasOwn(target, key)) {
    if (!isDeepStrictEqual(target[key], value)) conflict(path, diagnostics)
    return
  }
  setOwn(target, key, value)
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
}

function unsupported(path: string[], diagnostics: Diagnostic[]) {
  diagnostics.push({ kind: "unsupported", path, message: "Omitted native setting that cannot be represented in V1" })
}

function conflict(path: string[], diagnostics: Diagnostic[]) {
  diagnostics.push({ kind: "conflict", path, message: "Retained legacy value over native value" })
}
