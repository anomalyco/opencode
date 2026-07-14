import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Stream } from "effect"
import { EventV2 } from "../event"
import { ModelsDev } from "../models-dev"

export const ModelsDevPlugin = define({
  id: "opencode.models-dev",
  effect: Effect.fn(function* (ctx) {
    const modelsDev = yield* ModelsDev.Service
    const events = yield* EventV2.Service
    const loaded = { data: structuredClone(yield* modelsDev.get()) }
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
          method: { type: "env", names: [...provider.environment] },
        })
      }
    })
    yield* ctx.catalog.transform((catalog) => {
      for (const provider of loaded.data) {
        catalog.provider.update(provider.info.id, (draft) => {
          Object.assign(draft, provider.info)
          draft.integrationID = provider.info.id
        })
        for (const model of provider.models) {
          catalog.model.update(provider.info.id, model.id, (draft) => Object.assign(draft, model))
        }
      }
    })
    yield* events.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() =>
        modelsDev.get().pipe(
          Effect.tap((data) => Effect.sync(() => (loaded.data = structuredClone(data)))),
          Effect.andThen(ctx.integration.reload()),
          Effect.andThen(ctx.catalog.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
