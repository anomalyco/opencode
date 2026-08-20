import { define } from "@opencode-ai/plugin/effect/plugin"
import { Integration } from "@opencode-ai/schema/integration"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import { ModelsDev } from "../models-dev.js"
import { Provider } from "../provider.js"

export const ModelsDevPlugin = define({
  id: "opencode.models.dev",
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
        integrations.method.update({
          integrationID,
          method: {
            type: "env",
            names: environmentNames(provider),
          },
        })
      }
    })
    yield* ctx.catalog.transform((catalog) => {
      for (const provider of loaded.data) {
        catalog.provider.update(provider.info.id, (draft) => {
          Object.assign(draft, provider.info)
          draft.integrationID = Integration.ID.make(provider.info.id)
        })
        for (const model of provider.models) {
          if (model.status === "deprecated") continue
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
  if (provider.info.id === Provider.ID.azure)
    return [...provider.environment.filter((name) => name.endsWith("_API_KEY")), "AZURE_COGNITIVE_SERVICES_API_KEY"]
  // models.dev advertises project, location, and the ADC credentials file path for
  // Vertex. Those configure Google auth rather than carrying a key, so only the
  // Express Mode key may become a credential; GoogleVertexPlugin handles activation.
  if (provider.info.id === Provider.ID.googleVertex) return ["GOOGLE_VERTEX_API_KEY"]
  return [...provider.environment]
}

function snapshots(data: readonly ModelsDev.Snapshot[]) {
  return structuredClone(data).filter(
    // These deprecated aliases are replaced by the canonical Azure and Google Vertex providers.
    (provider) => provider.info.id !== "azure-cognitive-services" && provider.info.id !== "google-vertex-anthropic",
  )
}
