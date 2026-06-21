import { Config } from "@/config/config"
import { ConfigReload } from "@/config/reload"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Provider } from "@/provider/provider"
import { InstanceStore } from "@/project/instance-store"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi, RootHttpApi } from "../api"
import { markInstanceForDisposal, markInstanceForReload } from "../lifecycle"
import { WorkspaceRouteContext } from "../middleware/workspace-routing"

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
      return { success: true, immediate: result.immediate, bootstrapCycle: result.bootstrapCycle }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("providers", providers)
      .handle("reload", reload)
  }),
)

export const configLifecycleHandlers = HttpApiBuilder.group(RootHttpApi, "config-lifecycle", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const store = yield* InstanceStore.Service
    const reloadState = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(EventV2Bridge.Service, events), Effect.provideService(InstanceStore.Service, store))

    const reloadStatus = Effect.fn("ConfigLifecycleHttpApi.reloadStatus")(function* () {
      const route = yield* WorkspaceRouteContext
      return yield* reloadState(
        ConfigReload.statusForLocation({ directory: route.directory, workspaceID: route.workspaceID }),
      )
    })

    const bootstrapComplete = Effect.fn("ConfigLifecycleHttpApi.bootstrapComplete")(function* (ctx) {
      const route = yield* WorkspaceRouteContext
      return {
        success: yield* reloadState(
          ConfigReload.completeBootstrapForLocation({
            directory: route.directory,
            workspaceID: route.workspaceID,
            cycle: ctx.query.cycle,
          }),
        ),
      }
    })

    return handlers.handle("reloadStatus", reloadStatus).handle("bootstrapComplete", bootstrapComplete)
  }),
)
