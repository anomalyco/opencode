import { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"
import { Context, Effect, Layer, Record } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool, tool, jsonSchema } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { mergeDeep } from "remeda"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import {
  LLMClient,
  type ProtocolID,
} from "@opencode-ai/llm"
import { RequestExecutor } from "@opencode-ai/llm/adapter"
import {
  AnthropicMessages,
  BedrockConverse,
  Gemini,
  OpenAIChat,
  OpenAICompatibleChat,
  OpenAIResponses,
} from "@opencode-ai/llm/protocols"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
// Aliased to avoid a name clash with the AI SDK `Tool` type imported above.
import type { Tool as OpenCodeTool } from "@/tool/tool"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { EffectBridge } from "@/effect/bridge"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { LLMNative } from "./llm-native"
import { LLMNativeEvents } from "./llm-native-events"
import { LLMNativeTools } from "./llm-native-tools"

const log = Log.create({ service: "llm" })
export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX
type Result = Awaited<ReturnType<typeof streamText>>

type PreparedStream = {
  readonly language: LanguageModelV3
  readonly cfg: Config.Info
  readonly item: Provider.Info
  readonly system: string[]
  readonly options: Record<string, any>
  readonly messages: ModelMessage[]
  readonly params: {
    readonly temperature?: number
    readonly topP?: number
    readonly topK?: number
    readonly maxOutputTokens?: number
    readonly options: Record<string, any>
  }
  readonly headers: Record<string, string>
  readonly tools: Record<string, Tool>
}

// Avoid re-instantiating remeda's deep merge types in this hot LLM path; the runtime behavior is still mergeDeep.
const mergeOptions = (target: Record<string, any>, source: Record<string, any> | undefined): Record<string, any> =>
  mergeDeep(target, source ?? {}) as Record<string, any>

export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  nativeMessages?: ReadonlyArray<MessageV2.WithParts>
  // OpenCode-native `Tool.Def[]` parallel to `tools` (AI SDK shape). When
  // populated alongside `tools`, the LLM-native path forwards definitions to
  // the model and can dispatch multi-round tool loops without changing the
  // existing AI SDK path.
  nativeTools?: ReadonlyArray<OpenCodeTool.Def>
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export type Event = Result["fullStream"] extends AsyncIterable<infer T> ? T : never

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<Event, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

const live: Layer.Layer<
  Service,
  never,
  | Auth.Service
  | Config.Service
  | Provider.Service
  | Plugin.Service
  | Permission.Service
  | RequestExecutor.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    // Required by the LLM-native stream path. The default layer wires it on
    // top of `FetchHttpClient.layer`. Yielded here (not inside `runNative`)
    // so the executor instance is shared across every native stream the
    // service hands out.
    const executor = yield* RequestExecutor.Service

    const prepare = Effect.fn("LLM.prepareStream")(function* (input: StreamRequest) {
      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )

      // TODO: move this to a proper hook
      const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"

      const system: string[] = []
      system.push(
        [
          // use agent prompt otherwise provider prompt
          ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
          // any custom prompt passed into this call
          ...input.system,
          // any custom prompt from last user message
          ...(input.user.system ? [input.user.system] : []),
        ]
          .filter((x) => x)
          .join("\n"),
      )

      const header = system[0]
      yield* plugin.trigger(
        "experimental.chat.system.transform",
        { sessionID: input.sessionID, model: input.model },
        { system },
      )
      // rejoin to maintain 2-part structure for caching if header unchanged
      if (system.length > 2 && system[0] === header) {
        const rest = system.slice(1)
        system.length = 0
        system.push(header, rest.join("\n"))
      }

      const variant =
        !input.small && input.model.variants && input.user.model.variant
          ? input.model.variants[input.user.model.variant]
          : {}
      const base = input.small
        ? ProviderTransform.smallOptions(input.model)
        : ProviderTransform.options({
            model: input.model,
            sessionID: input.sessionID,
            providerOptions: item.options,
          })
      const options = mergeOptions(mergeOptions(mergeOptions(base, input.model.options), input.agent.options), variant)
      if (isOpenaiOauth) {
        options.instructions = system.join("\n")
      }

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const messages = isOpenaiOauth
        ? input.messages
        : isWorkflow
          ? input.messages
          : [
              ...system.map(
                (x): ModelMessage => ({
                  role: "system",
                  content: x,
                }),
              ),
              ...input.messages,
            ]

      const params = yield* plugin.trigger(
        "chat.params",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: item,
          message: input.user,
        },
        {
          temperature: input.model.capabilities.temperature
            ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
            : undefined,
          topP: input.agent.topP ?? ProviderTransform.topP(input.model),
          topK: ProviderTransform.topK(input.model),
          maxOutputTokens: ProviderTransform.maxOutputTokens(input.model),
          options,
        },
      )

      const { headers } = yield* plugin.trigger(
        "chat.headers",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: item,
          message: input.user,
        },
        {
          headers: {},
        },
      )

      const tools = resolveTools(input)

      // LiteLLM and some Anthropic proxies require the tools parameter to be present
      // when message history contains tool calls, even if no tools are being used.
      // Add a dummy tool that is never called to satisfy this validation.
      // This is enabled for:
      // 1. Providers with "litellm" in their ID or API ID (auto-detected)
      // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
      const isLiteLLMProxy =
        item.options?.["litellmProxy"] === true ||
        input.model.providerID.toLowerCase().includes("litellm") ||
        input.model.api.id.toLowerCase().includes("litellm")

      // LiteLLM/Bedrock rejects requests where the message history contains tool
      // calls but no tools param is present. When there are no active tools (e.g.
      // during compaction), inject a stub tool to satisfy the validation requirement.
      // The stub description explicitly tells the model not to call it.
      if (
        (isLiteLLMProxy || input.model.providerID.includes("github-copilot")) &&
        Object.keys(tools).length === 0 &&
        hasToolCalls(input.messages)
      ) {
        tools["_noop"] = tool({
          description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              reason: { type: "string", description: "Unused" },
            },
          }),
          execute: async () => ({ output: "", title: "", metadata: {} }),
        })
      }

      return { language, cfg, item, system, options, messages, params, headers, tools } satisfies PreparedStream
    })

    const transportHeaders = Effect.fn("LLM.transportHeaders")(function* (
      input: StreamRequest,
      headers: Record<string, string>,
    ) {
      if (input.model.providerID.startsWith("opencode")) {
        return {
          "x-opencode-project": (yield* InstanceState.context).project.id,
          "x-opencode-session": input.sessionID,
          "x-opencode-request": input.user.id,
          "x-opencode-client": Flag.OPENCODE_CLIENT,
          "User-Agent": `opencode/${InstallationVersion}`,
          ...input.model.headers,
          ...headers,
        }
      }
      return {
        "x-session-affinity": input.sessionID,
        ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
        "User-Agent": `opencode/${InstallationVersion}`,
        ...input.model.headers,
        ...headers,
      }
    })

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest, prepared: PreparedStream) {
      const l = log
        .clone()
        .tag("providerID", input.model.providerID)
        .tag("modelID", input.model.id)
        .tag("session.id", input.sessionID)
        .tag("small", (input.small ?? false).toString())
        .tag("agent", input.agent.name)
        .tag("mode", input.agent.mode)
      l.info("stream", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      if (prepared.language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel: GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: ((approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean; message?: string }>) | null
        } = prepared.language
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = prepared.system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = prepared.tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(prepared.tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const bridge = yield* EffectBridge.make()
        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = InstanceState.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionID.ascending()
          let unsub: (() => void) | undefined
          try {
            unsub = Bus.subscribe(Permission.Event.Replied, (evt) => {
              if (evt.properties.requestID === id) void evt.properties.reply
            })
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as unknown
                const value = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {}
                const title = "title" in value && typeof value.title === "string"
                  ? value.title
                  : "name" in value && typeof value.name === "string"
                    ? value.name
                    : ""
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            unsub?.()
          }
        })
      }

      const tracer = prepared.cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined
      const telemetryTracer = tracer
        ? new Proxy(tracer, {
            get(target, prop, receiver) {
              if (prop !== "startSpan") return Reflect.get(target, prop, receiver)
              return (...args: Parameters<typeof target.startSpan>) => {
                const span = target.startSpan(...args)
                span.setAttribute("session.id", input.sessionID)
                return span
              }
            },
          })
        : undefined

      return streamText({
        onError(error) {
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && prepared.tools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
            }
          }
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        temperature: prepared.params.temperature,
        topP: prepared.params.topP,
        topK: prepared.params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, prepared.params.options),
        activeTools: Object.keys(prepared.tools).filter((x) => x !== "invalid"),
        tools: prepared.tools,
        toolChoice: input.toolChoice,
        maxOutputTokens: prepared.params.maxOutputTokens,
        abortSignal: input.abort,
        headers: yield* transportHeaders(input, prepared.headers),
        maxRetries: input.retries ?? 0,
        messages: prepared.messages,
        model: wrapLanguageModel({
          model: prepared.language,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, prepared.options)
                }
                return args.params
              },
            },
          ],
        }),
        experimental_telemetry: {
          isEnabled: prepared.cfg.experimental?.openTelemetry,
          functionId: "session.llm",
          tracer: telemetryTracer,
          metadata: {
            userId: prepared.cfg.username ?? "unknown",
            sessionId: input.sessionID,
          },
        },
      })
    })

    // ----- LLM-native opt-in path -----
    //
    // `runNative` returns the session-shaped Stream when (and only when) the
    // request matches the narrow opt-in profile we've actively wired:
    //
    //   - The flag `OPENCODE_EXPERIMENTAL_LLM_NATIVE` is set.
    //   - The caller populated `input.nativeMessages` with `MessageV2.WithParts`
    //     (the AI SDK `messages` array isn't enough — the LLM-native bridge
    //     needs the typed parts).
    //   - The bridge can route the model to one of the protocols listed in
    //     `NATIVE_PROTOCOLS`. The adapter registry is broader than this
    //     allowlist so we can enable providers incrementally.
    //   - If tools are present, the caller supplied a native tool definition
    //     for every AI SDK tool key so the native path can dispatch them.
    //
    // Otherwise it returns `undefined` and the caller falls through to the
    // existing AI SDK path. The return shape is deliberately narrow — we are
    // not yet committed to native-by-default for any provider.
    const NATIVE_PROTOCOLS = new Set<ProtocolID>(["anthropic-messages"])
    const NATIVE_ADAPTERS = [
      AnthropicMessages.adapter,
      OpenAIChat.adapter,
      OpenAIResponses.adapter,
      Gemini.adapter,
      OpenAICompatibleChat.adapter,
      BedrockConverse.adapter,
    ]

    const nativeClient = LLMClient.make({
      adapters: NATIVE_ADAPTERS,
    })

    const runNative = Effect.fn("LLM.runNative")(function* (input: StreamRequest, prepared: PreparedStream) {
      if (!Flag.OPENCODE_EXPERIMENTAL_LLM_NATIVE) return undefined
      if (!input.nativeMessages || input.nativeMessages.length === 0) return undefined
      if (input.retries && input.retries > 0) return undefined
      if (prepared.cfg.experimental?.openTelemetry) return undefined
      // The native core does not yet carry AI SDK providerOptions. If request
      // preparation produced any, keep exact behavior by falling back.
      if (Object.keys(prepared.params.options).length > 0) return undefined
      // The native dispatcher needs a `Tool.Def` for every AI SDK tool key
      // the model might call. Two failure modes the gate has to catch:
      //
      //   1. AI SDK tools present but `nativeTools` undefined / empty —
      //      caller didn't (or couldn't) supply native shapes.
      //   2. AI SDK tools include a key that's missing from `nativeTools` —
      //      coverage gap. Today this happens with MCP tools (only AI SDK
      //      shape) and the synthesized `StructuredOutput` tool. The
      //      `prompt.ts:resolveTools` call sets `nativeTools: undefined` in
      //      both cases, but check defensively in case a future caller
      //      passes a partial set.
      //
      // Either way fall through so the session takes the AI SDK path
      // unchanged.
      const aiToolKeys = Object.keys(prepared.tools)
      if (aiToolKeys.length > 0) {
        if (input.nativeTools === undefined || input.nativeTools.length === 0) return undefined
        const nativeIDs = new Set(input.nativeTools.map((tool) => tool.id))
        for (const key of aiToolKeys) {
          if (!nativeIDs.has(key)) return undefined
        }
      }

      // Mirror the AI SDK path's permission/user-disabled filter for both
      // the AI SDK record (used as the dispatch table) and the native tool
      // definitions (sent to the model). Without this, the model would see
      // tools that the session has actively disabled.
      const filteredAITools = prepared.tools
      const allowedIds = new Set(Object.keys(filteredAITools))
      const filteredNativeTools = input.nativeTools?.filter((tool) => allowedIds.has(tool.id))

      const llmRequest = yield* LLMNative.request({
        id: input.user.id,
        provider: prepared.item,
        model: input.model,
        system: prepared.system,
        messages: input.nativeMessages,
        tools: filteredNativeTools,
        toolChoice: input.toolChoice,
        generation: {
          maxTokens: prepared.params.maxOutputTokens,
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
        },
        headers: yield* transportHeaders(input, prepared.headers),
      }).pipe(
        Effect.catchTag("LLMNative.UnsupportedModelError", () => Effect.void),
        Effect.catchTag("LLMNative.UnsupportedContentError", () => Effect.void),
      )
      if (!llmRequest) return undefined
      if (!NATIVE_PROTOCOLS.has(llmRequest.model.protocol)) return undefined

      log.info("native stream", {
        sessionID: input.sessionID,
        modelID: input.model.id,
        providerID: input.model.providerID,
        protocol: llmRequest.model.protocol,
      })

      // Stateful LLMEvent → SessionEvent translator. `map.map(event)` is called
      // per-element, `map.flush()` emits the remaining `*-end` events for any
      // text/reasoning/tool-input parts left open at stream close. The flush
      // stream is built lazily (`Stream.unwrap(Effect.sync(...))`) so it
      // observes the mapper's final state after `flatMap` has consumed every
      // upstream event.
      //
      // The upstream source is one of two paths:
      //
      //   - When `nativeTools` is unset (zero-tool sessions), call the LLM
      //     client directly. One model round, single stream, no dispatch.
      //   - When `nativeTools` is set, hand both the request and the matching
      //     AI SDK `tools` record to `LLMNativeTools.runWithTools`, which
      //     drives the multi-round loop with streaming dispatch: each
      //     `tool-call` event forks a tool handler fiber, and the
      //     handler's result is injected back into the same stream as a
      //     synthetic `tool-result` event. Long-running tools don't block
      //     subsequent tool-call streaming.
      const map = LLMNativeEvents.mapper()
      const upstream = filteredNativeTools && filteredNativeTools.length > 0
        ? LLMNativeTools.runWithTools({
            client: nativeClient,
            request: llmRequest,
            tools: filteredAITools,
            abort: input.abort,
          })
        : nativeClient.stream(llmRequest)
      return upstream.pipe(
        Stream.flatMap((event) => Stream.fromIterable(map.map(event))),
        Stream.concat(Stream.unwrap(Effect.sync(() => Stream.fromIterable(map.flush())))),
        Stream.provideService(RequestExecutor.Service, executor),
      )
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const request = { ...input, abort: ctrl.signal }
            const prepared = yield* prepare(request)

            const native = yield* runNative(request, prepared)
            if (native) return native

            const result = yield* run(request, prepared)

            return Stream.fromAsyncIterable(result.fullStream, (e) => (e instanceof Error ? e : new Error(String(e))))
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

export const layer = live.pipe(Layer.provide(Permission.defaultLayer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(RequestExecutor.defaultLayer),
  ),
)

function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

// Check if messages contain any tool-call content
// Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export * as LLM from "./llm"
