import { BrowserWindow } from "electron"
import { parseDesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"
import { Effect } from "effect"
import { AppRpcs } from "../../shared/ipc-rpc"
import { openExternalURL } from "../files"
import { checkAppExists, resolveAppPath } from "../files/apps"
import { setForceFocus } from "../native/debug"
import { DesktopLogging, scoped } from "../native/logging"
import { createMenu, sendMenuCommand } from "../native/menu"
import { setNativeTranslations } from "../native/translations"
import { IpcPortHandoff } from "../ipc-transport"
import { ApplicationLifecycle } from "../lifecycle"
import { finishFirstLaunchOnboarding, isFirstLaunchOnboardingPending } from "../lifecycle/onboarding"
import { Initialization } from "../service/initialization"
import { getDefaultServerUrl, setDefaultServerUrl } from "../service/server-settings"
import { Updater } from "../updater"
import { getLastFocusedWindow, setBackgroundColor } from "../windows"
import { sender } from "./context"

export const appHandlers = AppRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const lifecycle = yield* ApplicationLifecycle.Service
    const initialization = yield* Initialization.Service
    const updater = yield* Updater.Service
    const logging = yield* DesktopLogging.Service
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    return AppRpcs.of({
      AppAwaitInitialization: () => initialization.await,
      AppConsumeInitialDeepLinks: () => Effect.sync(lifecycle.consumeInitialDeepLinks),
      AppGetDefaultServerUrl: () => Effect.sync(getDefaultServerUrl),
      AppSetDefaultServerUrl: ({ url }) => Effect.sync(() => setDefaultServerUrl(url)),
      AppIsFirstLaunchOnboardingPending: isFirstLaunchOnboardingPending,
      AppFinishFirstLaunchOnboarding: ({ createDefaultProject }) =>
        finishFirstLaunchOnboarding(createDefaultProject).pipe(Effect.orDie),
      AppCheckAppExists: ({ appName }) => checkAppExists(appName).pipe(Effect.orDie),
      AppResolveAppPath: ({ appName }) => resolveAppPath(appName).pipe(Effect.orDie),
      AppSetBackgroundColor: ({ color }) => Effect.sync(() => setBackgroundColor(color)),
      AppExportDebugLogs: () => logging.exportDebug,
      AppSetForceFocus: ({ enabled }, context) => promise(() => setForceFocus(sender(handoff, context), enabled)),
      AppRecordFatalRendererError: ({ error }) =>
        scoped("renderer", Effect.logError("fatal renderer error", { ...error })),
      AppSetNativeTranslations: ({ value }, context) =>
        Effect.sync(() => {
          const contents = sender(handoff, context)
          const win = BrowserWindow.fromWebContents(contents)
          if (!win || win.isDestroyed() || win.webContents !== contents) {
            throw new Error("Invalid native translation sender")
          }
          const bundle = parseDesktopNativeBundle(value)
          if (!bundle) throw new Error("Invalid native translation bundle")
          if (!setNativeTranslations(bundle)) return
          createMenu({
            trigger: (id) => {
              const win = getLastFocusedWindow()
              if (win) sendMenuCommand(win, id)
            },
            checkForUpdates: () => runFork(updater.show),
            createWindow: lifecycle.createWindow,
            openExternal: (url) => runFork(openExternalURL(url)),
            relaunch: lifecycle.relaunch,
          })
        }),
      AppRelaunch: () => Effect.sync(lifecycle.relaunch),
    })
  }),
)

function promise<A>(evaluate: () => A | Promise<A>) {
  return Effect.tryPromise(async () => evaluate()).pipe(Effect.orDie)
}
