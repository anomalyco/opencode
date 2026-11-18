// Every open menu's close, so one call closes them all (menu-open.ts's closeAllMenus in the app,
// src/client/menus.ts's closeMenus on the static pages). No Solid here, so both share one list, and
// the Solid overlays a static page mounts close with its own menus.
const closers = new Set<() => void>()

/** Adds a close; the returned function removes it. */
export function addMenuCloser(close: () => void) {
  closers.add(close)
  return () => void closers.delete(close)
}

/** Runs every close but `except` (the menu that is opening). */
export function runMenuClosers(except?: () => void) {
  closers.forEach((close) => close !== except && close())
}
