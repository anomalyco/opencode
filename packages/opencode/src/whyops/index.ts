import { Context, Effect, Layer } from "effect"
import { Config } from "@/config"
import { Log } from "@/util"

const log = Log.create({ service: "whyops" })

export interface Trace {
  userMessage(messages: unknown[], opts?: { metadata?: { systemPrompt?: string } }): Promise<void>
  llmResponse(
    model: string,
    provider: string,
    text: string,
    opts?: {
      finishReason?: string
      latencyMs?: number
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    },
  ): Promise<void>
  toolCallRequest(name: string, args: unknown[], opts?: { latencyMs?: number }): Promise<string>
  toolCallResponse(name: string, spanId: string, args: unknown[], output: unknown, opts?: { latencyMs?: number }): Promise<void>
  error(message: string, opts?: { stack?: string; status?: number }): Promise<void>
}

export interface Interface {
  readonly enabled: boolean
  readonly trace: (traceId: string) => Trace
}

// No-op trace used when WhyOps is not configured
const noopTrace: Trace = {
  userMessage: async () => {},
  llmResponse: async () => {},
  toolCallRequest: async () => "",
  toolCallResponse: async () => {},
  error: async () => {},
}

const noopInterface: Interface = {
  enabled: false,
  trace: () => noopTrace,
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WhyOps") {}

const live = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const cfg = yield* config.get()

    const whyopsCfg = cfg.experimental?.whyops
    const apiKey = whyopsCfg?.apiKey ?? process.env.WHYOPS_API_KEY

    if (!apiKey) {
      log.info("WhyOps disabled: no API key configured")
      return Service.of(noopInterface)
    }

    const agentName = whyopsCfg?.agentName ?? "opencode"

    // Dynamic import to avoid bundling when not in use
    const { WhyOps: WhyOpsClient } = yield* Effect.promise(() => import("@whyops/sdk"))

    const client = new WhyOpsClient({
      apiKey,
      agentName,
      agentMetadata: {
        systemPrompt: "AI-powered development assistant",
        description: "opencode: AI coding agent that reads, writes, and runs code in your local environment",
        tools: [],
      },
    })

    yield* Effect.promise(async () => {
      try {
        await client.initAgent()
      } catch (err) {
        log.warn("WhyOps agent init failed", { error: err })
      }
    })

    log.info("WhyOps enabled", { agentName })

    return Service.of({
      enabled: true,
      trace: (traceId: string) => client.trace(traceId) as unknown as Trace,
    })
  }),
)

export const layer = live
export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as WhyOps from "."
