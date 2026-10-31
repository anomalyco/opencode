// A window close that would leave trading bots running stops for a native warning first.
// The bots are children of the sidecar server, so they keep trading without the window.
import { BrowserWindow, dialog } from "electron"
import { nativeT } from "../native/translations"
import { SidecarCredentials } from "../service/sidecar-credentials"

/** The close must not hang on a stalled sidecar: a quick check, then close untouched. */
const TIMEOUT_MS = 1_500

/** Names of the trading bots the engine reports as running, or undefined when unreachable. */
const botsEnMarcha = async () => {
  const sidecar = SidecarCredentials.get()
  if (!sidecar) return

  const authorization = SidecarCredentials.authorization(sidecar, sidecar.url)
  try {
    const { OpenCode } = await import("@opencode/client")
    const api = OpenCode.make({ baseUrl: sidecar.url, headers: authorization ? { authorization } : {} })
    const snapshot = await api.experimental.trading.snapshot({ signal: AbortSignal.timeout(TIMEOUT_MS) })
    const nombres = snapshot.systems.filter((system) => system.running).map((system) => system.name)
    return nombres
  } catch {
    // A down engine has nothing to answer for: closing is safe. Its bots die with the sidecar.
    return
  }
}

/** Returns whether closing the window may go on: yes with no running bot, after the user
 * confirms knowingly with one, and yes again whenever the engine cannot be reached. */
export const confirmTradingClose = async (win: BrowserWindow) => {
  const names = await botsEnMarcha()
  if (names === undefined || names.length === 0) return true

  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    message: nativeT("desktop.trading.closeWarning"),
    detail: nativeT("desktop.trading.closeWarning.detail", { names: names.join(", ") }),
    buttons: [nativeT("desktop.trading.closeWarning.action.close"), nativeT("desktop.trading.closeWarning.action.cancel")],
    defaultId: 1,
    cancelId: 1,
  })

  return response === 0
}
