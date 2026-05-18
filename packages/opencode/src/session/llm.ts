import { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Context, Effect, Layer, Record } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool, tool, jsonSchema } from "ai"
import { mergeDeep } from "remeda"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { Agent } from "@/agent/agent"
import { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
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

const log = Log.create({ service: "llm" })
export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX
type Result = Awaited<ReturnType<typeof streamText>>

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
  fallbacks?: Array<{ providerID: string; modelID: string }>
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
  Auth.Service | Config.Service | Provider.Service | Plugin.Service | Permission.Service | Bus.Service | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const bus = yield* Bus.Service
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

      const cfg = yield* config.get()
      const tools = resolveTools(input)

      const tryProvider = (model: Provider.Model, providerID: string, _modelID: string) =>
        Effect.gen(function* () {
          const language = yield* provider.getLanguage(model)
          const [item, info] = yield* Effect.all(
            [provider.getProvider(providerID), auth.get(providerID)],
            { concurrency: "unbounded" },
          )

          // TODO: move this to a proper hook
          const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"

          const system: string[] = []
          system.push(
            [
              // use agent prompt otherwise provider prompt
              ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(model)),
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
            { sessionID: input.sessionID, model },
            { system },
          )
          // rejoin to maintain 2-part structure for caching if header unchanged
          if (system.length > 2 && system[0] === header) {
            const rest = system.slice(1)
            system.length = 0
            system.push(header, rest.join("\n"))
          }

          // GitHub Copilot may require the tools parameter when message history contains
          // tool calls but no tools are active (e.g. compaction). Inject a stub tool that
          // is never meant to be invoked.
          if (
            model.providerID.includes("github-copilot") &&
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
          const sortedTools = Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b)))

          if (language instanceof GitLabWorkflowLanguageModel) {
            const workflowModel = language as GitLabWorkflowLanguageModel & {
              sessionID?: string
              sessionPreapprovedTools?: string[]
              approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
            }
            workflowModel.sessionID = input.sessionID
            workflowModel.systemPrompt = system.join("\n")
            workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
              const t = sortedTools[toolName]
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
            workflowModel.sessionPreapprovedTools = Object.keys(sortedTools).filter((name) => {
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

          const variant =
            !input.small && model.variants && input.user.model.variant
              ? model.variants[input.user.model.variant]
              : {}
          const base = input.small
            ? ProviderTransform.smallOptions(model)
            : ProviderTransform.options({
                model,
                sessionID: input.sessionID,
                providerOptions: item.options,
              })
          const options = mergeOptions(mergeOptions(mergeOptions(base, model.options), input.agent.options), variant)
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
              model,
              provider: item,
              message: input.user,
            },
            {
              temperature: model.capabilities.temperature
                ? (input.agent.temperature ?? ProviderTransform.temperature(model))
                : undefined,
              topP: input.agent.topP ?? ProviderTransform.topP(model),
              topK: ProviderTransform.topK(model),
              maxOutputTokens: ProviderTransform.maxOutputTokens(model, flags.outputTokenMax),
              options,
            },
          )

          const { headers } = yield* plugin.trigger(
            "chat.headers",
            {
              sessionID: input.sessionID,
              agent: input.agent.name,
              model,
              provider: item,
              message: input.user,
            },
            {
              headers: {},
            },
          )

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

          const opencodeProjectID = model.providerID.startsWith("opencode")
            ? (yield* InstanceState.context).project.id
            : undefined

          return streamText({
            onError(error) {
              l.error("stream error", {
                error,
              })
            },
            async experimental_repairToolCall(failed) {
              const lower = failed.toolCall.toolName.toLowerCase()
              if (lower !== failed.toolCall.toolName && sortedTools[lower]) {
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
            temperature: params.temperature,
            topP: params.topP,
            topK: params.topK,
            providerOptions: ProviderTransform.providerOptions(model, params.options),
            activeTools: Object.keys(sortedTools).filter((x) => x !== "invalid"),
            tools: sortedTools,
            toolChoice: input.toolChoice,
            maxOutputTokens: params.maxOutputTokens,
            abortSignal: input.abort,
            headers: {
              ...(model.providerID.startsWith("opencode")
                ? {
                    "x-opencode-project": opencodeProjectID,
                    "x-opencode-session": input.sessionID,
                    "x-opencode-request": input.user.id,
                    "x-opencode-client": flags.client,
                    "User-Agent": `opencode/${InstallationVersion}`,
                  }
                : {
                    "x-session-affinity": input.sessionID,
                    ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
                    "User-Agent": `opencode/${InstallationVersion}`,
                  }),
              ...model.headers,
              ...headers,
            },
            maxRetries: input.retries ?? 0,
            messages,
            model: wrapLanguageModel({
              model: language,
              middleware: [
                {
                  specificationVersion: "v3" as const,
                  async transformParams(args) {
                    if (args.type === "stream") {
                      // @ts-expect-error
                      args.params.prompt = ProviderTransform.message(args.params.prompt, model, options)
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
            return result as unknown as Stream.Stream<Event, unknown>
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
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(Bus.defaultLayer),
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
// Used to determine if a dummy tool should be added (GitHub Copilot only; see stream()).
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
