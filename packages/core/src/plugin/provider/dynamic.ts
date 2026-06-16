import { Npm } from "../../npm"
import { Effect, Option } from "effect"
import { pathToFileURL } from "url"
import { PluginV2 } from "../../plugin"

export const DynamicProviderPlugin = PluginV2.define({
  id: PluginV2.ID.make("dynamic-provider"),
  effect: Effect.gen(function* () {
    const npm = yield* Npm.Service
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.sdk) return

        const installedPath = evt.package.startsWith("file://")
          ? evt.package
          : Option.getOrUndefined((yield* npm.add(evt.package).pipe(Effect.orDie)).entrypoint)
        if (!installedPath) throw new Error(`Package ${evt.package} has no import entrypoint`)

        const mod = yield* Effect.promise(async () => {
          return (await import(
            installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href
          )) as Record<string, (options: any) => any>
        }).pipe(Effect.orDie)
        const match = Object.keys(mod).find((name) => name.startsWith("create"))
        if (!match) throw new Error(`Package ${evt.package} has no provider factory export`)

        evt.sdk = mod[match](evt.options)
      }),
    }
  }),
})
