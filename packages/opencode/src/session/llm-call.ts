import type { Provider } from "@/provider/provider"
import type { Auth } from "@/auth"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import type { Config } from "@/config/config"
import type { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { ProviderID } from "@/provider/schema"
import { Effect, Option } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import type { LLMEvent } from "@opencode-ai/llm"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import type { Agent } from "@/agent/agent"
import { MessageV2 } from "./message-v2"
import { PermissionID } from "@/permission/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { EffectBridge } from "@/effect/bridge"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import * as Log from "@opencode-ai/core/util/log"
import { LLMAISDK } from "./llm/ai-sdk"
import { LLMNativeRuntime } from "./llm/native-runtime"
import { LLMRequestPrep } from "./llm/request"

const log = Log.create({ service: "llm-call" })

export type ProviderResult =
  | { type: "native"; stream: Stream.Stream<LLMEvent, unknown> }
  | { type: "ai-sdk"; result: any }

export type CallInput = {
  model: Provider.Model
  providerID: string
  modelID: string
  sessionID: string
  parentSessionID?: string
  user: MessageV2.User
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  abort: AbortSignal
  deps: {
    provider: {
      getLanguage: (model: Provider.Model) => Effect.Effect<any, unknown>
      getProvider: (providerID: ProviderID) => Effect.Effect<Provider.Info, unknown>
    }
    auth: {
      get: (providerID: ProviderID) => Effect.Effect<Auth.Info | undefined, unknown>
    }
    plugin: Plugin.Interface
    perm: Permission.Interface
    config: {
      get: () => Effect.Effect<Config.Info, unknown>
    }
    flags: RuntimeFlags.Info
    llmClient: any
    events: EventV2Bridge.Service
  }
  log?: {
    info: (msg: string, ...args: any[]) => void
    error: (msg: string, ...args: any[]) => void
  }
}

export const makeLLMCall = Effect.fn("LLMCall.make")(function* (input: CallInput) {
  const { model, providerID, abort, deps } = input
  const l = input.log ?? log
    .clone()
    .tag("providerID", providerID)
    .tag("modelID", model.id)
    .tag("session.id", input.sessionID)
  const language = yield* deps.provider.getLanguage(model)
  const [item, info] = yield* Effect.all(
    [
      deps.provider.getProvider(ProviderID.make(providerID)),
      deps.auth.get(ProviderID.make(providerID)),
    ],
    { concurrency: "unbounded" },
  )

  const isWorkflow = language instanceof GitLabWorkflowLanguageModel
  const prepared = yield* LLMRequestPrep.prepare({
    ...input,
    model,
    provider: item,
    auth: info,
    plugin: deps.plugin,
    flags: deps.flags,
    isWorkflow,
  })

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
          abortSignal: abort,
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
      // Auto-approve tools that were already approved in this session
      // (prevents infinite approval loops for server-side MCP tools)
      if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
        return { approved: true }
      }

      const id = PermissionID.ascending()
      let unsub: EventV2.Unsubscribe | undefined
      try {
        unsub = await bridge.promise(
          deps.events.listen((event) => {
            if (event.type !== Permission.Event.Replied.type) return Effect.void
            const data = event.data as EventV2.Data<typeof Permission.Event.Replied>
            if (data.requestID !== id) return Effect.void
            void data.reply
            return Effect.void
          }),
        )
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
          deps.perm.ask({
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
        if (unsub) await bridge.promise(unsub)
      }
    })
  }

  const cfg = yield* deps.config.get()

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

  if (deps.flags.experimentalNativeLlm) {
    const native = LLMNativeRuntime.stream({
      model,
      provider: item,
      auth: info,
      llmClient: deps.llmClient,
      messages: prepared.messages,
      tools: prepared.tools,
      toolChoice: input.toolChoice,
      temperature: prepared.params.temperature,
      topP: prepared.params.topP,
      topK: prepared.params.topK,
      maxOutputTokens: prepared.params.maxOutputTokens,
      providerOptions: prepared.params.options,
      headers: prepared.headers,
      abort,
    })
    if (native.type === "supported") {
      yield* Effect.logInfo("llm runtime selected").pipe(
        Effect.annotateLogs({
          "llm.runtime": "native",
          "llm.provider": providerID,
          "llm.model": model.id,
        }),
      )
      return { type: "native" as const, stream: native.stream }
    }
    yield* Effect.logInfo("llm runtime selected").pipe(
      Effect.annotateLogs({
        "llm.runtime": "ai-sdk",
        "llm.provider": providerID,
        "llm.model": model.id,
        "llm.native_unsupported_reason": native.reason,
      }),
    )
    l.info("native runtime unavailable; falling back to ai-sdk", { reason: native.reason })
  }

  yield* Effect.logInfo("llm runtime selected").pipe(
    Effect.annotateLogs({
      "llm.runtime": "ai-sdk",
      "llm.provider": providerID,
      "llm.model": model.id,
    }),
  )

  const result = streamText({
    onError(error) {
      l.error("stream error", { error })
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
    providerOptions: ProviderTransform.providerOptions(model, prepared.params.options),
    activeTools: Object.keys(prepared.tools).filter((x) => x !== "invalid"),
    tools: prepared.tools,
    toolChoice: input.toolChoice,
    maxOutputTokens: prepared.params.maxOutputTokens,
    abortSignal: abort,
    headers: prepared.headers,
    maxRetries: input.retries ?? 0,
    messages: prepared.messages,
    model: wrapLanguageModel({
      model: language,
      middleware: [
        {
          specificationVersion: "v3" as const,
          async transformParams(args) {
            if (args.type === "stream") {
              // @ts-expect-error
              args.params.prompt = ProviderTransform.message(
                args.params.prompt,
                model,
                prepared.messageTransformOptions,
              )
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

  return { type: "ai-sdk" as const, result }
})

export function toStream(providerResult: ProviderResult): Stream.Stream<LLMEvent, unknown> {
  if (providerResult.type === "native") return providerResult.stream
  const state = LLMAISDK.adapterState()
  return Stream.fromAsyncIterable(providerResult.result.fullStream as AsyncIterable<any>, (e) =>
    e instanceof Error ? e : new Error(String(e)),
  ).pipe(
    Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event)),
    Stream.flatMap((events) => Stream.fromIterable(events)),
  )
}

export * as LLMCall from "./llm-call"