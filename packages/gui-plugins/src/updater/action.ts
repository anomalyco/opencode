import type { UpdaterState } from "@opencode/plugin/gui/updater"
import type { WindowUpdaterState } from "./window-machine"

/**
 * The one update action the settings row and the titlebar pill offer for a state. The window's own check or install
 * shows as running at once, before main reports it, so a second click has nothing to start.
 */
export function updaterAction(state: UpdaterState | undefined, windowState?: WindowUpdaterState) {
  const action = mainAction(state)

  if (windowState?.status === "checking" && action.run === "check") return { label: "action.checking" as const }

  if (windowState?.status === "installing" && action.run === "install") return { label: "action.installing" as const }

  return action
}

/**
 * The titlebar pill for a state, or nothing while the update has nothing to show. A check that finds a release
 * downloads it at once, so the pill covers the download too: busy, and with no install to run until it is on disk.
 */
export function updaterPill(state: UpdaterState | undefined, windowState?: WindowUpdaterState) {
  const downloading = state?.status === "downloading"
  const installing = state?.status === "installing"
  const ready = state?.status === "ready" || state?.status === "download-required"

  if (!ready && !installing && !downloading) return

  return {
    label: updaterAction(state, windowState).label,
    busy: downloading || installing,
    install: !downloading,
  }
}

function mainAction(state: UpdaterState | undefined) {
  if (!state) return { label: "action.checkNow" as const }

  switch (state.status) {
    case "checking":
      return { label: "action.checking" as const }
    case "downloading":
      return { label: "action.downloading" as const }
    case "ready":
      return { label: "action.installRestart" as const, run: "install" as const }
    case "download-required":
      return { label: "action.download" as const, run: "install" as const }
    case "installing":
      return { label: "action.installing" as const }
    case "disabled":
      return { label: "action.unavailable" as const, description: "check.unavailable" as const }
    default:
      return { label: "action.checkNow" as const, run: "check" as const }
  }
}
