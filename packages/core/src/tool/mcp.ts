export * as McpTool from "./mcp.js"

import { ToolFailure } from "@opencode/ai/effect"
import { McpEvent } from "@opencode/schema/mcp-event"
import { Context, Effect, Fiber, type JsonSchema, Layer, Option, PubSub, Schema, Semaphore, Stream } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { extension } from "mime-types"
import { Bus } from "../bus.js"

import { Mcp } from "../mcp/index.js"
import { Mime } from "../mime.js"
import { Permission } from "../permission.js"
import { Tool } from "../tool.js"
import { ToolOutput } from "../tool-output.js"
import { ReadToolFileSystem } from "./read-filesystem.js"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/**
 * Registry namespace and permission action names for MCP tools.
 */
export const namespace = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")
export const name = (server: string, tool: string) => `${namespace(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

export interface Interface {
  /** Wait for the initial MCP tool registration to settle. */
  readonly flush: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpTool") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const tools = yield* Tool.Service
    const bus = yield* Bus.Service
    const permission = yield* Permission.Service
    const toolOutput = yield* ToolOutput.Service
    const lock = Semaphore.makeUnsafe(1)
    let discovered: Mcp.Tool[] = []

    // Register once after initial discovery; only subsequent updates need a debounced reload.
    const initial = yield* lock
      .withPermit(
        Effect.gen(function* () {
          discovered = yield* mcp.tools()
          yield* tools.transform((editor) => {
            for (const tool of discovered) {
              editor.add({
                name: tool.name,
                options: { namespace: namespace(tool.server), codemode: tool.codemode !== false },
                description: tool.description ?? "",
                input: (tool.inputSchema ?? { type: "object", properties: {} }) as JsonSchema.JsonSchema,
                output: (tool.outputSchema ?? {}) as JsonSchema.JsonSchema,
                execute: (input, context) =>
                  Effect.gen(function* () {
                    yield* permission.assert({
                      action: name(tool.server, tool.name),
                      resources: ["*"],
                      save: ["*"],
                      metadata: { input: input ?? {} },
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source: {
                        type: "tool",
                        messageID: context.messageID,
                        id: context.id,
                      },
                    })
                    const result = yield* mcp
                      .callTool({
                        server: tool.server,
                        name: tool.name,
                        args: (input ?? {}) as Record<string, unknown>,
                        sessionID: context.sessionID,
                      })
                      .pipe(
                        Effect.catchTags({
                          "MCP.NotFoundError": (error) =>
                            new ToolFailure({ message: `MCP server "${error.server}" is not available` }),
                          "MCP.ToolCallError": (error) => new ToolFailure({ message: error.message }),
                        }),
                      )
                    if (result.isError)
                      return yield* new ToolFailure({
                        message:
                          result.content
                            .flatMap((part) => (part.type === "text" ? [part.text] : []))
                            .join("\n")
                            .trim() || "MCP tool returned an error",
                      })
                    const content = yield* Effect.forEach(result.content, (part) => toContent(part, toolOutput))
                    const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                    const output = () => {
                      if (result.structured !== undefined) return result.structured
                      if (text === "") return null
                      // Agents assume JSON returned as text is already an object, so parse it when the server declares no schema.
                      if (tool.outputSchema === undefined && (text.startsWith("{") || text.startsWith("[")))
                        return Option.getOrElse(decodeJson(text), () => text)
                      return text
                    }
                    return {
                      output: output(),
                      ...(content.length === 0 ? {} : { content }),
                    }
                  }).pipe(
                    Effect.mapError((error) =>
                      error instanceof ToolFailure
                        ? error
                        : new ToolFailure({ message: `Unable to execute ${name(tool.server, tool.name)}` }),
                    ),
                  ),
              })
            }
          })
        }),
      )
      .pipe(Effect.forkScoped)
    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        discovered = yield* mcp.tools()
        yield* tools.reload()
      }),
    )

    // Servers announce tools in bursts and each read loads the whole catalog, so settle and refresh
    // once. The bus subscription stays eager; only the already-open sliding subscription is debounced.
    const changes = yield* PubSub.sliding<void>(1)
    yield* bus.subscribe(McpEvent.ToolsChanged).pipe(
      Stream.runForEach(() => PubSub.publish(changes, undefined)),
      Effect.forkScoped({ startImmediately: true }),
    )
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({ flush: Effect.asVoid(Fiber.await(initial)) })
  }),
)

// Only media the read tool also accepts is sent inline; other types would fail request lowering on every later turn.
const toContent = Effect.fnUntraced(function* (part: Mcp.ToolResultContent, toolOutput: ToolOutput.Interface) {
  if (part.type === "text") return { type: "text" as const, text: part.text }
  const mime = part.mimeType.split(";", 1)[0].trim().toLowerCase()
  if (ReadToolFileSystem.MEDIA_MIMES.has(mime))
    return { type: "file" as const, uri: `data:${part.mimeType};base64,${part.data}`, mime: part.mimeType }
  const bytes = Buffer.from(part.data, "base64")
  const label = part.uri ?? "content"
  if (Mime.isTextual(mime))
    return { type: "text" as const, text: `[Resource ${label} (${part.mimeType})]\n${bytes.toString("utf8")}` }
  const ext = extension(mime)
  const file = yield* toolOutput.save(bytes, ext ? `.${ext}` : "")
  return {
    type: "text" as const,
    text: `[Binary resource ${label} (${part.mimeType}, ${bytes.byteLength} bytes) saved to ${file}]`,
  }
})

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Tool.node, Mcp.node, Bus.node, Permission.node, ToolOutput.node],
})
