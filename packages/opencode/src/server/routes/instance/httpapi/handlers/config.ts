import { Config } from "@/config/config"
import { ConfigReload } from "@/config/reload"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Provider } from "@/provider/provider"
import { InstanceStore } from "@/project/instance-store"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal, markInstanceForReload } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const store = yield* InstanceStore.Service
    const reloadState = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(EventV2Bridge.Service, events), Effect.provideService(InstanceStore.Service, store))

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    const reload = Effect.fn("ConfigHttpApi.reload")(function* () {
      const result = yield* reloadState(ConfigReload.request())
      if (result.immediate) yield* markInstanceForReload(yield* InstanceState.context, result.input)
      return { success: true, immediate: result.immediate }
    })

    const bootstrapComplete = Effect.fn("ConfigHttpApi.bootstrapComplete")(function* (ctx) {
      if (ctx.query.cycle !== (yield* reloadState(ConfigReload.getBootstrapCycle()))) return { success: false }
      yield* reloadState(ConfigReload.releaseBlocker("tui-bootstrap"))
      return { success: true }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("providers", providers)
      .handle("reload", reload)
      .handle("bootstrapComplete", bootstrapComplete)
  }),
)
