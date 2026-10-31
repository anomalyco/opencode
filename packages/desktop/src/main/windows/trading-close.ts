// A window close that would leave trading bots running or open positions unattended stops
// for a native warning first. The bots are children of the sidecar server, so they keep
// trading — and the positions stay exposed — without the window.
import { BrowserWindow, dialog } from "electron"
import { nativeT } from "../native/translations"
import { SidecarCredentials } from "../service/sidecar-credentials"

/** The close must not hang on a stalled sidecar: a quick check, then close untouched. */
const TIMEOUT_MS = 1_500

/** What the close would orphan: one snapshot's running systems and open positions.
 * Undefined means the engine did not answer — a down sidecar takes its bots with it, so
 * unreached is treated as nothing left to warn about. */
const comercioAbierto = async () => {
  const sidecar = SidecarCredentials.get()
  if (!sidecar) return
  const authorization = SidecarCredentials.authorization(sidecar, sidecar.url)
  const { OpenCode } = await import("@opencode/client")
  const api = OpenCode.make({ baseUrl: sidecar.url, headers: authorization ? { authorization } : {} })
  const snapshot = await api.experimental.trading.snapshot({ signal: AbortSignal.timeout(TIMEOUT_MS) })
  return {
    bots: snapshot.systems.filter((system) => system.running).map((system) => system.name),
    posiciones: snapshot.positions.map((position) => position.symbol),
  }
}

/** Returns whether closing the window may go on: yes with nothing left exposed, after the
 * user confirms knowingly the bots and/or positions that would stay behind, and yes again
 * whenever the engine cannot be reached. */
export const confirmTradingClose = async (win: BrowserWindow) => {
  const abierto = await comercioAbierto().catch(() => undefined)
  if (abierto === undefined) return true

  // Either exposure alone warns with its own list; both together read as one mixed warning,
  // so the user sees not just the stranded positions but that a live bot could reopen more.
  const conBots = abierto.bots.length > 0
  const conPosiciones = abierto.posiciones.length > 0
  if (!conBots && !conPosiciones) return true
  const names = abierto.bots.join(", ")
  const symbols = abierto.posiciones.join(", ")
  const message = nativeT(
    conBots && conPosiciones
      ? "desktop.trading.closeWarning.mixed"
      : conBots
        ? "desktop.trading.closeWarning"
        : "desktop.trading.closeWarning.positions",
  )
  const detail = nativeT(
    conBots && conPosiciones
      ? "desktop.trading.closeWarning.mixed.detail"
      : conBots
        ? "desktop.trading.closeWarning.detail"
        : "desktop.trading.closeWarning.positions.detail",
    conBots && conPosiciones ? { names, symbols } : conBots ? { names } : { symbols },
  )

  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    message,
    detail,
    buttons: [nativeT("desktop.trading.closeWarning.action.close"), nativeT("desktop.trading.closeWarning.action.cancel")],
    defaultId: 1,
    cancelId: 1,
  })

  return response === 0
}
