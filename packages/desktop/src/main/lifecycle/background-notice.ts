import { dialog, type BrowserWindow } from "electron"
import { nativeT } from "../native/translations"
import { getBackgroundNoticeShown, getKeepServiceRunning, setBackgroundNoticeShown } from "../service/keep-running"
import { initialState, transition, type Choice, type Event } from "./background-notice-machine"

/**
 * Tells the user once, on their first quit, that the background service keeps running, with the choice to open
 * Settings instead of quitting.
 */
export function createBackgroundNotice(input: {
  /** The window to attach the dialog to, if one is still open. */
  readonly parent: () => BrowserWindow | undefined
  readonly quit: () => void
  readonly openSettings: () => void
}) {
  const current = { state: initialState(getBackgroundNoticeShown()) }

  const dispatch = (event: Event) => {
    const next = transition(current.state, event)
    current.state = next.state

    next.commands.forEach((command) => {
      if (command.type === "show") return void show()

      if (command.type === "persist-shown") return setBackgroundNoticeShown()

      if (command.type === "open-settings") return input.openSettings()

      input.quit()
    })

    return next.holdsQuit
  }

  const show = () => {
    const parent = input.parent()

    const options: Electron.MessageBoxOptions = {
      type: "info",
      message: nativeT("desktop.backgroundNotice.message"),
      detail: nativeT("desktop.backgroundNotice.detail"),
      buttons: [nativeT("desktop.backgroundNotice.quit"), nativeT("desktop.backgroundNotice.openSettings")],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }

    // A failed dialog must not leave the quit held forever.
    void (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
      .then((result): Choice => (result.response === 1 ? "settings" : "quit"))
      .catch((): Choice => "quit")
      .then((choice) => dispatch({ type: "dialog.closed", choice }))
  }

  /** Whether the quit the user just started has to wait for the notice. */
  return { holdsQuit: () => dispatch({ type: "quit.requested", keepRunning: getKeepServiceRunning() }) }
}
