import { app } from "electron"
import { Predicate } from "effect"
import { windowBootstrapArgument, type WindowBootstrap } from "../../shared/window-bootstrap"
import { getDefaultServerUrl } from "../service/server-settings"
import { FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

// The settings store is already in memory when a window is created, so the renderer gets the
// answers its shell gate would otherwise ask for over IPC. A fresh install has no onboarding
// decision yet; the renderer asks once the layers have made one.
export function windowBootstrap(id: string): WindowBootstrap {
  const complete = getStore().get(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY)

  return {
    id,
    firstLaunchPending: Predicate.isBoolean(complete) ? !complete : undefined,
    defaultServerUrl: getDefaultServerUrl(),
    packaged: app.isPackaged,
  }
}

export function windowArguments(id: string) {
  return [windowBootstrapArgument(windowBootstrap(id))]
}
