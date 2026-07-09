import { Effect } from "effect"
import { pathToFileURL } from "url"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Npm } from "../../npm"
import { ProviderV2 } from "../../provider"

export const SapAICorePlugin = define({
  id: "opencode.provider.sap-ai-core",
  effect: Effect.fn(function* (ctx) {
    const npm = yield* Npm.Service
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("sap-ai-core")) return
        const serviceKey =
          process.env.AICORE_SERVICE_KEY ??
          (typeof evt.options.serviceKey === "string" ? evt.options.serviceKey : undefined)
        if (serviceKey && !process.env.AICORE_SERVICE_KEY) process.env.AICORE_SERVICE_KEY = serviceKey

        const installedPath = evt.package.startsWith("file://")
          ? evt.package
          : (yield* npm.add(evt.package).pipe(Effect.orDie)).entrypoint
        if (!installedPath) return yield* Effect.die(new Error(`Package ${evt.package} has no import entrypoint`))

        const mod: Record<string, unknown> = yield* Effect.promise(
          () => import(installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href),
        )
        const match = Object.keys(mod).find((name) => name.startsWith("create"))
        if (!match) return yield* Effect.die(new Error(`Package ${evt.package} has no provider factory export`))
        const factory = mod[match]
        if (typeof factory !== "function")
          return yield* Effect.die(new Error(`Package ${evt.package} provider factory export is not callable`))

        evt.sdk = factory(
          serviceKey
            ? { deploymentId: process.env.AICORE_DEPLOYMENT_ID, resourceGroup: process.env.AICORE_RESOURCE_GROUP }
            : {},
        )
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("sap-ai-core")) return
        evt.language = evt.sdk(evt.model.modelID ?? evt.model.id)
      }),
    )
  }),
})
