import { Provider } from "@/provider/provider"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Context, Effect, Layer, Record } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import type { LLMEvent } from "@opencode-ai/llm"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "@opencode-ai/llm/route"
import type { LLMClientService } from "@opencode-ai/llm/route"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import type { Agent } from "@/agent/agent"
import { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import {
  CooldownManager,
  SessionFallbackState,
  matchUserFallbackConfig,
  withFallback,
  type ClassifiedError,
  type FallbackOnErrorsConfig,
} from "./fallback"
import { ProviderID } from "@/provider/schema"
import { SessionRetry } from "./retry"
import { LLMAISDK } from "./llm/ai-sdk"
import { LLMNativeRuntime } from "./llm/native-runtime"
import { LLMRequestPrep } from "./llm/request"

const log = Log.create({ service: "llm" })
export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

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
  fallbacks?: Array<{ providerID: string; modelID: string }>
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

export const use = serviceUse(Service)

const live: Layer.Layer<
  Service,
  never,
  | Auth.Service
  | Config.Service
  | Provider.Service
  | Plugin.Service
  | Permission.Service
  | Bus.Service
  | LLMClientService
  | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const bus = yield* Bus.Service
    const llmClient = yield* LLMClient.Service
    const flags = yield* RuntimeFlags.Service
    const cooldown = new CooldownManager()
    const sessionFallbackState = new SessionFallbackState()

    // Build a request-scoped classifyError that closes over the current
    // config snapshot. We need a snapshot here (not a live read) so that
    // chainFallback's cause handler — which runs inside a Stream pipeline
    // — has zero async dependencies on the config service.
    const makeClassifyError = (overrides: FallbackOnErrorsConfig | undefined) =>
      (cause: Cause.Cause<unknown>, prevProviderID: string, _prevModelID: string, _cooldownSeconds: number):
        | ClassifiedError
        | null => {
        const error = Cause.squash(cause)
        let err = MessageV2.fromError(error, { providerID: ProviderID.make(prevProviderID) })
        if (
          !MessageV2.APIError.isInstance(err) &&
          !MessageV2.ContextOverflowError.isInstance(err) &&
          !MessageV2.AbortedError.isInstance(err)
        ) {
          err = new MessageV2.APIError({
            message:
              typeof error === "string"
                ? error
                : error instanceof Error
                  ? error.message
                  : "Unknown stream error",
            isRetryable: true,
          }).toObject()
        }
        if (MessageV2.AbortedError.isInstance(err)) return null

        // 1) User-configured overrides win.
        const userMatch = matchUserFallbackConfig(err, overrides)
        // 2) Otherwise, fall through to SessionRetry's built-in heuristics.
        const retryInfo = userMatch ?? SessionRetry.retryable(err as unknown as SessionRetry.Err, prevProviderID)
        if (!retryInfo) return null
        return {
          error: err,
          isRetryable: true,
          retryInfo,
          reason: retryInfo.message ?? "error",
        }
      }

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
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

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const prepared = yield* LLMRequestPrep.prepare({
        ...input,
        provider: item,
        auth: info,
        plugin,
        flags,
        isWorkflow,
      })

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = prepared.system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = prepared.tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
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
        workflowModel.approvalHandler = bridge.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
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
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
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
            workflowModel.sessionPreapprovedTools = [
              ...(workflowModel.sessionPreapprovedTools ?? []),
              ...uniqueNames,
            ]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            unsub?.()
          }
        })
      }

      const tracer = cfg.experimental?.openTelemetry
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

      const tryProvider = (m: Provider.Model, providerID: string, _modelID: string) =>
        Effect.gen(function* () {
          const lang = yield* provider.getLanguage(m)
          const [provItem, provInfo] = yield* Effect.all(
            [provider.getProvider(ProviderID.make(providerID)), auth.get(ProviderID.make(providerID))],
            { concurrency: "unbounded" },
          )
          const wf = lang instanceof GitLabWorkflowLanguageModel
          const p = yield* LLMRequestPrep.prepare({
            ...input,
            model: m,
            provider: provItem,
            auth: provInfo,
            plugin,
            flags,
            isWorkflow: wf,
          })
          return streamText({
            onError(error) {
              l.error("stream error", { error })
            },
            async experimental_repairToolCall(failed) {
              const lower = failed.toolCall.toolName.toLowerCase()
              if (lower !== failed.toolCall.toolName && p.tools[lower]) {
                l.info("repairing tool call", { tool: failed.toolCall.toolName, repaired: lower })
                return { ...failed.toolCall, toolName: lower }
              }
              return {
                ...failed.toolCall,
                input: JSON.stringify({ tool: failed.toolCall.toolName, error: failed.error.message }),
                toolName: "invalid",
              }
            },
            temperature: p.params.temperature,
            topP: p.params.topP,
            topK: p.params.topK,
            providerOptions: ProviderTransform.providerOptions(m, p.params.options),
            activeTools: Object.keys(p.tools).filter((x) => x !== "invalid"),
            tools: p.tools,
            toolChoice: input.toolChoice,
            maxOutputTokens: p.params.maxOutputTokens,
            abortSignal: input.abort,
            headers: p.headers,
            maxRetries: input.retries ?? 0,
            messages: p.messages,
            model: wrapLanguageModel({
              model: lang,
              middleware: [
                {
                  specificationVersion: "v3" as const,
                  async transformParams(args) {
                    if (args.type === "stream") {
                      // @ts-expect-error
                      args.params.prompt = ProviderTransform.message(args.params.prompt, m, p.messageTransformOptions)
                    }
                    return args.params
                  },
                },
              ],
            }),
            experimental_telemetry: {
              isEnabled: cfg.experimental?.openTelemetry,
              functionId: "session.llm",
              tracer: telemetryTracer,
              metadata: {
                userId: cfg.username ?? "unknown",
                sessionId: input.sessionID,
              },
            },
          })
        })

      // Runtime seam: native is an opt-in adapter over @opencode-ai/llm. It
      // either returns a ready LLMEvent stream or a concrete fallback reason.
      if (flags.experimentalNativeLlm) {
        const native = LLMNativeRuntime.stream({
          model: input.model,
          provider: item,
          auth: info,
          llmClient,
          messages: prepared.messages,
          tools: prepared.tools,
          toolChoice: input.toolChoice,
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          maxOutputTokens: prepared.params.maxOutputTokens,
          providerOptions: prepared.params.options,
          headers: prepared.headers,
          abort: input.abort,
        })
        if (native.type === "supported") {
          yield* Effect.logInfo("llm runtime selected").pipe(
            Effect.annotateLogs({
              "llm.runtime": "native",
              "llm.provider": input.model.providerID,
              "llm.model": input.model.id,
            }),
          )
          return {
            type: "native" as const,
            stream: native.stream,
          }
        }
        yield* Effect.logInfo("llm runtime selected").pipe(
          Effect.annotateLogs({
            "llm.runtime": "ai-sdk",
            "llm.provider": input.model.providerID,
            "llm.model": input.model.id,
            "llm.native_unsupported_reason": native.reason,
          }),
        )
        l.info("native runtime unavailable; falling back to ai-sdk", { reason: native.reason })
      }

      yield* Effect.logInfo("llm runtime selected").pipe(
        Effect.annotateLogs({
          "llm.runtime": "ai-sdk",
          "llm.provider": input.model.providerID,
          "llm.model": input.model.id,
        }),
      )

      return yield* withFallback(
        {
          sessionID: input.sessionID,
          model: input.model as Provider.Model & { providerID: string; id: string },
          fallbacks: input.fallbacks,
          abort: input.abort,
        },
        {
          provider: {
            getModel: (p, m) => provider.getModel(p, m) as Effect.Effect<Provider.Model, unknown>,
            getProvider: (p) => provider.getProvider(p) as Effect.Effect<Provider.Info, unknown>,
          },
          bus,
          config: { get: () => config.get() as Effect.Effect<{ cooldown_seconds?: number }, unknown> },
          classifyError: makeClassifyError(cfg.fallback_on_errors),
          call: tryProvider,
          log: l,
          cooldown,
          sessionFallbackState,
        },
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
            const result = yield* run({ ...input, abort: ctrl.signal })

            if (typeof result === "object" && result !== null && "type" in result && (result as any).type === "native") {
              return (result as { type: "native"; stream: Stream.Stream<LLMEvent, unknown> }).stream
            }

            // withFallback returns Stream<StreamChunk, Error> which we need to
            // convert to Stream<LLMEvent>. StreamChunk is the raw AI SDK chunk.
            const fallbackStream = result as unknown as Stream.Stream<any, Error>
            return fallbackStream.pipe(
              Stream.mapError((e) => e),
            ) as unknown as Stream.Stream<LLMEvent, unknown>
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
    Layer.provide(
      LLMClient.layer.pipe(Layer.provide(Layer.mergeAll(RequestExecutor.defaultLayer, WebSocketExecutor.layer))),
    ),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(Bus.defaultLayer),
  ),
)

export const hasToolCalls = LLMRequestPrep.hasToolCalls

export * as LLM from "./llm"
