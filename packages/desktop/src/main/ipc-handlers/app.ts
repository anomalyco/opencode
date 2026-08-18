import { BrowserWindow } from "electron"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"
import { Effect } from "effect"
import type { FatalRendererError, ServerReadyData } from "../../shared/ipc-contract"
import { AppRpcs } from "../../shared/ipc-rpc"
import { setForceFocus } from "../native/debug"
import { IpcPortHandoff } from "../ipc-transport"
import { sender } from "./context"

export type AppHandlerDeps = {
  relaunch: () => void
  awaitInitialization: () => Promise<ServerReadyData>
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  isFirstLaunchOnboardingPending: () => Promise<boolean> | boolean
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null> | string | null
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  resolveAppPath: (appName: string) => Promise<string | null>
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
}

export function appHandlers(deps: AppHandlerDeps) {
  return AppRpcs.toLayer(
    Effect.gen(function* () {
      const handoff = yield* IpcPortHandoff
      return AppRpcs.of({
        AppAwaitInitialization: () => Effect.promise(() => deps.awaitInitialization()),
        AppConsumeInitialDeepLinks: () => promise(deps.consumeInitialDeepLinks),
        AppGetDefaultServerUrl: () => promise(deps.getDefaultServerUrl),
        AppSetDefaultServerUrl: ({ url }) => promise(() => deps.setDefaultServerUrl(url)),
        AppIsFirstLaunchOnboardingPending: () => promise(deps.isFirstLaunchOnboardingPending),
        AppFinishFirstLaunchOnboarding: ({ createDefaultProject }) =>
          promise(() => deps.finishFirstLaunchOnboarding(createDefaultProject)),
        AppCheckAppExists: ({ appName }) => promise(() => deps.checkAppExists(appName)),
        AppResolveAppPath: ({ appName }) => Effect.promise(() => deps.resolveAppPath(appName)),
        AppSetBackgroundColor: ({ color }) => Effect.sync(() => deps.setBackgroundColor(color)),
        AppExportDebugLogs: () => Effect.promise(() => deps.exportDebugLogs()),
        AppSetForceFocus: ({ enabled }, context) =>
          Effect.promise(() => setForceFocus(sender(handoff, context), enabled)),
        AppRecordFatalRendererError: ({ error }) => promise(() => deps.recordFatalRendererError(error)),
        AppSetNativeTranslations: ({ value }, context) =>
          Effect.sync(() => {
            const contents = sender(handoff, context)
            const win = BrowserWindow.fromWebContents(contents)
            if (!win || win.isDestroyed() || win.webContents !== contents) {
              throw new Error("Invalid native translation sender")
            }
            const bundle = parseDesktopNativeBundle(value)
            if (!bundle) throw new Error("Invalid native translation bundle")
            deps.setNativeTranslations(bundle)
          }),
        AppRelaunch: () => Effect.sync(deps.relaunch),
      })
    }),
  )
}

function promise<A>(evaluate: () => A | Promise<A>) {
  return Effect.promise(async () => evaluate())
}
