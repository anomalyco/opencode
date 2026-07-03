export * as McpTool from "./mcp"

import { createHash } from "node:crypto"
import { ToolFailure } from "@opencode-ai/llm"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, Exit, type JsonSchema, Scope, Semaphore, Stream } from "effect"
import { EventV2 } from "../event"
import { Flag } from "../flag/flag"
import { MCP } from "../mcp"
import { PermissionV2 } from "../permission"
import { ExecuteTool } from "./execute"
import { Tool } from "./tool"

const MAX_NAME_LENGTH = 64
const HASH_LENGTH = 8

const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_")
const hashSuffix = (raw: string) => "_" + createHash("sha1").update(raw).digest("hex").slice(0, HASH_LENGTH)
const fit = (base: string, raw: string) => base.slice(0, MAX_NAME_LENGTH - HASH_LENGTH - 1) + hashSuffix(raw)

const registrationName = (server: string, tool: string) => {
  const joined = sanitize(server) + "_" + sanitize(tool)
  const base = /^[A-Za-z]/.test(joined) ? joined : "mcp_" + joined
  return base.length > MAX_NAME_LENGTH ? fit(base, `${server}\u0000${tool}`) : base
}

export const permissionAction = (server: string, tool: string) => `mcp:${server}:${tool}`

const toContent = (part: MCP.ToolResultContent): Tool.Content =>
  part.type === "text" ? { type: "text", text: part.text } : { type: "file", data: part.data, mime: part.mimeType }

const errorText = (content: ReadonlyArray<MCP.ToolResultContent>) =>
  content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()

export const Plugin = {
  id: "core-mcp-tools",
  effect: Effect.fn("McpTool.Plugin")(function* (ctx: PluginContext) {
    const mcp = yield* MCP.Service
    const events = yield* EventV2.Service
    const permission = yield* PermissionV2.Service
    const scope = yield* Scope.Scope
    const lock = Semaphore.makeUnsafe(1)
    let current: Scope.Closeable | undefined

    const direct = (item: ExecuteTool.Item) =>
      Tool.make({
        description: item.tool.description ?? "",
        jsonSchema: jsonSchema(item.tool.inputSchema),
        execute: (input, context) =>
          Effect.gen(function* () {
            const args = recordInput(input)
            yield* permission
              .assert({
                sessionID: context.sessionID,
                agent: context.agent,
                action: item.action,
                resources: ["*"],
                save: ["*"],
                metadata: { server: item.tool.server, tool: item.tool.name, arguments: args },
                source: {
                  type: "tool",
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                },
              })
              .pipe(
                Effect.mapError(
                  (error) =>
                    new ToolFailure({
                      message: error instanceof PermissionV2.CorrectedError ? error.feedback : "Permission denied",
                    }),
                ),
              )
            const result = yield* mcp.callTool({ server: item.tool.server, name: item.tool.name, args }).pipe(
              Effect.catchTags({
                "MCP.NotFoundError": (error) =>
                  new ToolFailure({ message: `MCP server "${error.server}" is not available` }),
                "MCP.ToolCallError": (error) => new ToolFailure({ message: error.message }),
              }),
            )
            if (result.isError)
              return yield* new ToolFailure({ message: errorText(result.content) || "MCP tool returned an error" })
            return { structured: result.structured ?? {}, content: result.content.map(toContent) }
          }),
      })

    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        const items = entries(yield* mcp.tools())
        const record = Flag.OPENCODE_CODE_MODE
          ? items.length === 0
            ? {}
            : { execute: yield* ExecuteTool.make(items) }
          : Object.fromEntries(items.map((item) => [item.registration, direct(item)]))
        const next = yield* Scope.fork(scope)
        yield* ctx.tool.register(record).pipe(Scope.provide(next), Effect.orDie)
        if (current) yield* Scope.close(current, Exit.void)
        current = next
      }),
    )

    yield* events.subscribe(McpEvent.ToolsChanged).pipe(
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* reconcile
  }),
}

type Item = ExecuteTool.Item & { readonly registration: string }

function entries(tools: ReadonlyArray<MCP.Tool>): Item[] {
  const used = new Set<string>()
  const namespaces = codeModeNames(
    tools.map((tool) => tool.server.toString()),
    true,
  )
  const members = new Map(
    Array.from(new Set(tools.map((tool) => tool.server.toString()))).map((server) => [
      server,
      codeModeNames(
        tools.filter((tool) => tool.server === server).map((tool) => tool.name),
        false,
      ),
    ]),
  )
  return tools.map((tool) => {
    const initial = registrationName(tool.server, tool.name)
    const item = {
      action: permissionAction(tool.server, tool.name),
      namespace: namespaces.get(tool.server)!,
      member: members.get(tool.server)!.get(tool.name)!,
      tool,
    }
    if (!used.has(initial)) {
      used.add(initial)
      return { registration: initial, ...item }
    }
    const raw = `${tool.server}\u0000${tool.name}`
    let collision = 0
    let registration = fit(initial, raw)
    while (used.has(registration)) registration = fit(initial, `${raw}\u0000${++collision}`)
    used.add(registration)
    return { registration, ...item }
  })
}

function codeModeNames(values: ReadonlyArray<string>, namespace: boolean) {
  const unique = Array.from(new Set(values))
  const valid = (value: string) =>
    value.length > 0 &&
    !value.includes(".") &&
    value !== "__proto__" &&
    value !== "constructor" &&
    value !== "prototype" &&
    (!namespace || value !== "$codemode")
  const safe = unique.filter(valid)
  const used = new Set(safe)
  const result = new Map(safe.map((value) => [value, value]))
  for (const value of unique.filter((value) => !valid(value))) {
    let collision = 0
    let alias = `mcp_${sanitize(value).slice(0, 40)}${hashSuffix(value)}`
    while (used.has(alias)) alias = `mcp_${sanitize(value).slice(0, 40)}${hashSuffix(`${value}\u0000${++collision}`)}`
    used.add(alias)
    result.set(value, alias)
  }
  return result
}

function recordInput(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {}
}

function jsonSchema(input: unknown): JsonSchema.JsonSchema {
  return isRecord(input) ? input : { type: "object", properties: {} }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
