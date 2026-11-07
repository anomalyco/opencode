import { BrowserWindow } from "electron"
import { parseDesktopNativeBundle } from "@opencode/app/i18n/desktop-native"
import { Effect } from "effect"
import { AppRpcs } from "../../shared/ipc-rpc"
import { checkAppExists, resolveAppPath } from "../files/apps"
import { setForceFocus } from "../native/debug"
import { DesktopLogging, scoped } from "../native/logging"
import { getSpellcheckEnabled, setSpellcheckEnabled } from "../native/spellcheck"
import { setNativeTranslations } from "../native/translations"
import { IpcPortHandoff } from "../ipc-transport"
import { ApplicationLifecycle } from "../lifecycle"
import { finishFirstLaunchOnboarding, isFirstLaunchOnboardingPending } from "../lifecycle/onboarding"
import { BackgroundService } from "../service/background-service"
import { QuitBehavior } from "../service/quit-behavior"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { getWindowID, setBackgroundColor } from "../windows"
import { sender } from "./context"

export const appHandlers = AppRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const lifecycle = yield* ApplicationLifecycle.Service
    const background = yield* BackgroundService.Service
    const logging = yield* DesktopLogging.Service

    return AppRpcs.of({
      AppAwaitInitialization: () => background.connection.pipe(Effect.map(SidecarCredentials.ready)),
      AppReconnectService: () => background.reconnect.pipe(Effect.map(SidecarCredentials.ready)),
      AppReadyDeepLinks: (_request, context) =>
        Effect.sync(() => {
          const contents = sender(handoff, context)
          const win = BrowserWindow.fromWebContents(contents)
          // Only an app window's own renderer receives deep links, not one embedded in it.
          const id = win?.webContents === contents ? getWindowID(win) : undefined

          if (id) lifecycle.deepLinks.ready(id, context.client.id)
        }),
      AppAcknowledgeDeepLinks: ({ attempt }, context) =>
        Effect.sync(() => lifecycle.deepLinks.acknowledge(context.client.id, attempt)),
      AppIsFirstLaunchOnboardingPending: isFirstLaunchOnboardingPending,
      AppFinishFirstLaunchOnboarding: ({ createDefaultProject }) =>
        finishFirstLaunchOnboarding(createDefaultProject).pipe(Effect.orDie),
      AppCheckAppExists: ({ appName }) => checkAppExists(appName).pipe(Effect.orDie),
      AppResolveAppPath: ({ appName }) => resolveAppPath(appName).pipe(Effect.orDie),
      AppSetBackgroundColor: ({ color }) => Effect.sync(() => setBackgroundColor(color)),
      AppGetSpellcheckEnabled: () => Effect.sync(getSpellcheckEnabled),
      AppSetSpellcheckEnabled: ({ enabled }) => Effect.sync(() => setSpellcheckEnabled(enabled)),
      AppGetKeepServiceRunning: () => Effect.sync(QuitBehavior.getKeepServiceRunning),
      AppSetKeepServiceRunning: ({ enabled }) => Effect.sync(() => QuitBehavior.setKeepServiceRunning(enabled)),
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

          // An installed menu rebuilds through the translation listener in `ipc.ts`.
          setNativeTranslations(bundle)
        }),
      AppRelaunch: () => Effect.sync(lifecycle.relaunch),
    })
  }),
)

function promise<A>(evaluate: () => A | Promise<A>) {
  return Effect.tryPromise(async () => evaluate()).pipe(Effect.orDie)
}
