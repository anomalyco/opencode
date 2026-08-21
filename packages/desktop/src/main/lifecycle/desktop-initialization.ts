export * as DesktopInitialization from "./desktop-initialization"

import { app } from "electron"
import { Context, Effect, Layer } from "effect"
import { DesktopLogging } from "../native/logging"
import { getStore } from "../storage/store"
import {
  loadProxyEnvironment,
  preferApplicationEnvironment,
  prepareApplicationEnvironment,
  prepareDesktop,
} from "./environment"
import { initializeFirstLaunchOnboarding } from "./onboarding"

export interface Interface {
  readonly version: string
  readonly updaterStore: ReturnType<typeof getStore>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopInitialization") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const logging = yield* DesktopLogging.Service
    yield* initializeFirstLaunchOnboarding(app.getPath("userData"))
    yield* prepareApplicationEnvironment
    yield* preferApplicationEnvironment
    yield* loadProxyEnvironment
    yield* Effect.promise(() => app.whenReady())
    yield* logging.startNetwork
    yield* prepareDesktop
    return Service.of({
      version: app.getVersion(),
      updaterStore: getStore("opencode.updater"),
    })
  }),
)
