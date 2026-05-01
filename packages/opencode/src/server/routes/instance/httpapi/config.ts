import { Config } from "@/config"
import { Provider } from "@/provider"
import { Effect, Layer } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/config"

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          success: Provider.ConfigProvidersResult,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const configHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const svc = yield* Provider.Service

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* svc.list()
      return {
        providers: Object.values(providers),
        default: Provider.defaultModelIDs(providers),
      }
    })

    return HttpApiBuilder.group(ConfigApi, "config", (handlers) => handlers.handle("providers", providers))
  }),
).pipe(Layer.provide(Provider.defaultLayer), Layer.provide(Config.defaultLayer))
