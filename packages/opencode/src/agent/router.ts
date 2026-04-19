import { Effect, Layer, Context } from "effect"
import { Auth } from "../auth"
import { Provider } from "../provider"
import * as Session from "../session/session"
import { Agent } from "./agent"
import * as ModelIntelligence from "./model-intelligence/service"
import { Log } from "../util"

const log = Log.create({ service: "agent.router" })

export type BossPresetProvider = {
  providerId: string
  accountKey?: string
  modelId: string
  routing?: "sequential" | "parallel" | "fallback"
  priority?: number
}

export type BossPresetSettings = {
  spawnWorkers?: boolean
  maxWorkers?: number
  notifyOnComplete?: boolean
  effort_tier?: "low" | "medium" | "high"
  no_paid_apis?: boolean
  task_type?: string
}

export type BossPreset = {
  id: string
  name: string
  providers: BossPresetProvider[]
  settings: BossPresetSettings
}

export type RouteInput = {
  preset: BossPreset
  sessionID: string
  message: string
  system?: string[]
}

export type RouteResult = {
  providerId: string
  modelId: string
  success: boolean
  error?: string
}

export interface Interface {
  readonly route: (input: RouteInput) => Effect.Effect<RouteResult[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AgentRouter") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const provider = yield* Provider.Service
    const agentSvc = yield* Agent.Service
    const sessionSvc = yield* Session.Service
    yield* ModelIntelligence.Service

    const resolveAccount = Effect.fn("AgentRouter.resolveAccount")(
      function* (providerId: string, accountKey?: string) {
        const key = accountKey ?? (yield* auth.active(providerId)) ?? providerId
        return yield* auth.get(key)
      },
    )

    const resolveModel = Effect.fn("AgentRouter.resolveModel")(
      function* (providerId: string, modelId: string) {
        const providers = yield* provider.list()
        const connected = providers[providerId]
        if (!connected) throw new Error(`Provider not connected: ${providerId}`)
        const model = Object.values(connected.models).find(
          (m: { id: string }) => m.id === modelId || m.id.startsWith(modelId),
        )
        if (!model) throw new Error(`Model not found: ${modelId} on provider ${providerId}`)
        return { ...model, providerID: providerId }
      },
    )

    const executeForProvider = (input: RouteInput, presetProvider: BossPresetProvider) =>
      Effect.gen(function* (): RouteResult {
        const credentials = yield* resolveAccount(presetProvider.providerId, presetProvider.accountKey)
        if (!credentials) {
          return {
            providerId: presetProvider.providerId,
            modelId: presetProvider.modelId,
            success: false,
            error: `No credentials for ${presetProvider.providerId}${presetProvider.accountKey ? ` (${presetProvider.accountKey})` : ""}`,
          }
        }

        const model = yield* resolveModel(presetProvider.providerId, presetProvider.modelId)

        let targetSessionID = input.sessionID

        if (input.preset.settings.spawnWorkers) {
          const childSession = yield* sessionSvc.create({
            parentID: input.sessionID,
            title: `Worker: ${presetProvider.providerId}/${presetProvider.modelId}`,
          })
          targetSessionID = childSession.id
        }

        log.info("routing to provider", {
          providerId: presetProvider.providerId,
          modelId: presetProvider.modelId,
          sessionID: targetSessionID,
        })

        return {
          providerId: presetProvider.providerId,
          modelId: presetProvider.modelId,
          success: true,
        }
      }).pipe(
        Effect.catchAll((err) =>
          Effect.succeed<RouteResult>({
            providerId: presetProvider.providerId,
            modelId: presetProvider.modelId,
            success: false,
            error: String(err),
          }),
        ),
      )

    const route = Effect.fn("AgentRouter.route")(function* (input: RouteInput) {
      const settings = input.preset.settings

      if (settings.effort_tier) {
        const mi = yield* ModelIntelligence.Service
        const providerList = yield* provider.list()

        const availableModels: Array<{ provider_id: string; model_id: string }> = []
        for (const [providerId, prov] of Object.entries(providerList)) {
          for (const modelId of Object.keys(prov.models)) {
            availableModels.push({ provider_id: providerId, model_id: modelId })
          }
        }

        const selection = yield* mi.select({
          tier: settings.effort_tier,
          available_providers: Object.keys(providerList),
          available_models: availableModels,
          no_paid_apis: settings.no_paid_apis ?? false,
          task_type: settings.task_type,
        })

        if (!selection.provider_id) {
          return yield* Effect.fail(new Error("Model intelligence found no suitable model"))
        }

        const dynamicProvider: BossPresetProvider = {
          providerId: selection.provider_id,
          modelId: selection.model_id,
        }

        log.info("intelligence-routed model", {
          tier: settings.effort_tier,
          provider: selection.provider_id,
          model: selection.model_id,
          score: selection.score,
          reason: selection.reason,
          cost: selection.effective_cost,
        })

        return yield* Effect.all([executeForProvider(input, dynamicProvider)], { concurrency: 1 })
      }

      const providers = input.preset.providers
      if (providers.length === 0) {
        return yield* Effect.fail(new Error("No providers configured in preset"))
      }

      const routing = providers[0].routing ?? "sequential"

      if (routing === "parallel") {
        const maxConcurrency = input.preset.settings.maxWorkers ?? providers.length
        return yield* Effect.all(providers.map((p) => executeForProvider(input, p)), {
          concurrency: maxConcurrency,
        })
      }

      if (routing === "fallback") {
        const sorted = [...providers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
        for (const presetProvider of sorted) {
          const result = yield* executeForProvider(input, presetProvider)
          if (result.success) return [result]
        }
        return [
          {
            providerId: providers[0].providerId,
            modelId: providers[0].modelId,
            success: false,
            error: "All providers failed in fallback chain",
          },
        ]
      }

      const sorted = [...providers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      return yield* Effect.all(sorted.map((p) => executeForProvider(input, p)), {
        concurrency: 1,
      })
    })

    return Service.of({ route })
  }),
)
