import { define } from "@opencode-ai/plugin/effect/plugin"
import { Integration } from "@opencode-ai/schema/integration"
import { Effect, Stream } from "effect"
import { Bus } from "../bus"
import { ModelsDev } from "../models-dev"
import { Provider } from "../provider"

export const ModelsDevPlugin = define({
  id: "opencode.models-dev",
  effect: Effect.fn(function* (ctx) {
    const modelsDev = yield* ModelsDev.Service
    const bus = yield* Bus.Service
    const loaded = { data: snapshots(yield* modelsDev.get()) }
    yield* ctx.integration.transform((integrations) => {
      for (const provider of loaded.data) {
        if (provider.environment.length === 0) continue
        const integrationID = provider.info.id
        integrations.update(integrationID, (integration) => (integration.name = provider.info.name))
        integrations.method.update({
          integrationID,
          method: { type: "key" },
        })
        const names = environmentNames(provider)
        if (names.length > 0) {
          integrations.method.update({
            integrationID,
            method: {
              type: "env",
              names,
            },
          })
        }
      }
    })
    yield* ctx.catalog.transform((catalog) => {
      for (const provider of loaded.data) {
        catalog.provider.update(provider.info.id, (draft) => {
          Object.assign(draft, provider.info)
          draft.integrationID = Integration.ID.make(provider.info.id)
        })
        for (const model of provider.models) {
          catalog.model.update(provider.info.id, model.id, (draft) => Object.assign(draft, model))
        }
      }
    })
    yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() =>
        modelsDev.get().pipe(
          Effect.tap((data) => Effect.sync(() => (loaded.data = snapshots(data)))),
          Effect.andThen(ctx.integration.reload()),
          Effect.andThen(ctx.catalog.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

function environmentNames(provider: ModelsDev.Snapshot) {
  const names = provider.environment.filter((name) => !configurationEnvironmentNames.has(name))
  if (provider.info.id === Provider.ID.azure) names.push("AZURE_COGNITIVE_SERVICES_API_KEY")
  return names
}

const configurationEnvironmentNames = new Set([
  "AWS_REGION",
  "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
  "AZURE_RESOURCE_NAME",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
  "DATABRICKS_HOST",
  "INFOMANIAK_PRODUCT_ID",
  "NEON_AI_GATEWAY_BASE_URL",
  "SNOWFLAKE_ACCOUNT",
  "WATSONX_AI_PROJECT_ID",
])

function snapshots(data: readonly ModelsDev.Snapshot[]) {
  return structuredClone(data).filter(
    (provider) => provider.info.id !== "azure-cognitive-services" && provider.info.id !== "google-vertex-anthropic",
  )
}
