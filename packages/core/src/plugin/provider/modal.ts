import { Effect, Semaphore, Stream } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Bus } from "../../bus.js"
import { Catalog } from "../../catalog.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { ModalModels } from "../../modal/models.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.make("modal")

export const ModalPlugin = define({
  id: "opencode.provider.modal",
  effect: Effect.fn(function* (ctx) {
    const catalog = yield* Catalog.Service
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      baseURL?: string
      models?: Map<Model.ID, Model.Info>
    } = {}

    const load = Effect.fn("ModalPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active("modal")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const apiKey = credential?.type === "key" ? credential.key : process.env.MODAL_PROXY_TOKEN
      const provider = yield* catalog.provider.get(providerID)
      const baseURL = typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : undefined
      if (!apiKey || !baseURL) {
        loaded.baseURL = undefined
        loaded.models = undefined
        return
      }
      loaded.baseURL = baseURL
      const existing = (yield* catalog.model.all()).filter((model) => model.providerID === providerID)
      loaded.models = yield* Effect.tryPromise({
        try: () => ModalModels.get(baseURL, apiKey, existing),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) => Effect.logWarning("failed to sync Modal models", { cause }).pipe(Effect.as(undefined))),
      )
    })

    yield* ctx.catalog.transform((evt) => {
      const item = evt.provider.get(providerID)
      if (!item) return
      if (!loaded.models) return
      for (const id of item.models.keys()) {
        if (!loaded.models.has(Model.ID.make(id))) evt.model.remove(item.provider.id, id)
      }
      for (const [id, model] of loaded.models) {
        evt.model.update(item.provider.id, id, (draft) => Object.assign(draft, structuredClone(model)))
      }
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("modal")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)
