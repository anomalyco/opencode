import { BrowserWindow } from "electron"
import { Effect } from "effect"
import { MenuRpcs } from "../../shared/ipc-rpc"
import { IpcPortHandoff } from "../ipc-transport"
import { runDesktopMenuAction } from "../native/menu-actions"
import { sender } from "./context"

export function menuHandlers(deps: {
  readonly showUpdater: () => Promise<void> | void
  readonly relaunch: () => void
}) {
  return MenuRpcs.toLayer(
    Effect.gen(function* () {
      const handoff = yield* IpcPortHandoff
      return MenuRpcs.of({
        MenuRunAction: ({ action }, context) =>
          Effect.sync(() =>
            runDesktopMenuAction(BrowserWindow.fromWebContents(sender(handoff, context)), action, {
              checkForUpdates: () => void deps.showUpdater(),
              relaunch: deps.relaunch,
            }),
          ),
      })
    }),
  )
}
