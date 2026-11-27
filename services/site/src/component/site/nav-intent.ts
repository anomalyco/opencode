import type { NavMenusOptions } from "@opencode/nav-menus"

const events = "contextmenu keydown pointerdown pointerup pointercancel".split(" ")

/**
 * The shared logo menu (packages/nav-menus, with the brand files) for the site and the docs, loaded at the first sign
 * of opening it: a right-click, the menu key or a long press on the logo. The trigger's events from then until the code
 * has loaded play again, so that first right-click opens its menu. A failed load leaves the next sign to try again. No
 * Solid here: the docs script is plain DOM.
 */
export function navMenusOnIntent(options: NavMenusOptions) {
  let early: Event[] | undefined
  let stopped = false
  let menus: { close: () => void; stop: () => void } | undefined
  const listen = (on: boolean) =>
    events.forEach((type) =>
      on ? document.addEventListener(type, intent, true) : document.removeEventListener(type, intent, true),
    )

  function intent(event: Event) {
    const trigger = (event.target as Element).closest?.("[data-nav-logo]")
    if (!trigger) return
    // What would open the menu, held back from the browser as the menu does (no native menu).
    const opens =
      event instanceof KeyboardEvent
        ? event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")
        : event.type === "contextmenu"
    if (opens) event.preventDefault()
    const replay = opens || event instanceof PointerEvent
    if (early) return replay && early.push(event)
    const hint = event.type === "pointerdown" && (event as PointerEvent).pointerType === "touch"
    if (!opens && !hint) return
    early = replay ? [event] : []
    void import("@opencode/nav-menus").then(
      (module) => {
        if (stopped) return
        listen(false)
        // closeNavMenus is reassigned by installNavMenus, so it's read from the module when called.
        menus = { close: () => module.closeNavMenus(), stop: module.installNavMenus(options) }
        early?.forEach((event) =>
          event.target?.dispatchEvent(new (event.constructor as typeof Event)(event.type, event)),
        )
        early = undefined
      },
      () => (early = undefined),
    )
  }
  listen(true)

  return {
    /** Closes the nav logo menu if it is open; hosts call it when they open a menu of their own. */
    close: () => menus?.close(),
    stop: () => {
      stopped = true
      listen(false)
      menus?.stop()
    },
  }
}
