const refreshers = new Set<() => void>()

/** Registers a tray menu rebuild and returns an unsubscribe, so main and window code can refresh it in place. */
export function onTrayMenuRefresh(refresh: () => void) {
  refreshers.add(refresh)

  return () => refreshers.delete(refresh)
}

/** Rebuilds the tray menu after a window shows or hides, so its Show/Hide label stays accurate. */
export function refreshTrayMenu() {
  refreshers.forEach((refresh) => refresh())
}
