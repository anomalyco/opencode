import { EOL } from "os"
import { Effect, Layer, Option } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { effectCmd } from "../../effect-cmd"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"

const layer = Layer.mergeAll(Catalog.defaultLayer, PluginBoot.defaultLayer)

export const V2Command = effectCmd({
  command: "v2",
  describe: "debug v2 catalog and built-in plugins",
  instance: false,
  handler: Effect.fn("Cli.debug.v2")(function* () {
    const result = yield* Effect.gen(function* () {
      yield* PluginBoot.Service.use((s) => s.wait())
      const catalog = yield* Catalog.Service

      const providers = (yield* catalog.provider.available()).sort((a, b) => a.id.localeCompare(b.id))
      const all = (yield* catalog.provider.all()).sort((a, b) => a.id.localeCompare(b.id))
      return {
        providers,
        default: catalog.model
          .default()
          .pipe(Effect.map(Option.map((item) => item.id)), Effect.map(Option.getOrUndefined)),
        small: Object.fromEntries(
          yield* Effect.all(
            all.map((provider) =>
              Effect.map(
                catalog.model.small(provider.id),
                (model) => [provider.id, Option.getOrUndefined(Option.map(model, (item) => item.id))] as const,
              ),
            ),
            { concurrency: "unbounded" },
          ),
        ),
      }
    }).pipe(Effect.provide(layer), Effect.orDie)

    process.stdout.write(JSON.stringify(result, null, 2) + EOL)
  }),
})
