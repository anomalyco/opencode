import { BrowserWindow } from "electron"
import { Effect } from "effect"
import { MenuRpcs } from "../../shared/ipc-rpc"
import { IpcPortHandoff } from "../ipc-transport"
import { ApplicationLifecycle } from "../lifecycle"
import { runDesktopMenuAction } from "../native/menu-actions"
import { Updater } from "../updater"
import { sender } from "./context"

export const menuHandlers = MenuRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const lifecycle = yield* ApplicationLifecycle.Service
    const updater = yield* Updater.Service
    const runFork = Effect.runForkWith(yield* Effect.context())
    return MenuRpcs.of({
      MenuRunAction: ({ action }, context) =>
        Effect.sync(() =>
          runDesktopMenuAction(BrowserWindow.fromWebContents(sender(handoff, context)), action, {
            checkForUpdates: () => runFork(updater.show),
            createWindow: lifecycle.createWindow,
            relaunch: lifecycle.relaunch,
          }),
        ),
    })
  }),
)
