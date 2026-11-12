import type { NavMenusOptions } from "@opencode/nav-menus"

const events = "contextmenu keydown focusin pointerdown pointerup pointercancel pointerover pointerout".split(" ")

/**
 * The shared logo and product menus (packages/nav-menus, with the logo menu's brand files) for the site
 * and the docs, loaded at the first sign of opening one: a right-click, the menu key or a long press on
 * the logo, the pointer, focus or ↓ on a product's name. The trigger's events from then until the code
 * has loaded play again, so that first right-click or hover opens its menu. A failed load leaves the
 * next sign to try again. No Solid here: the docs script is plain DOM.
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
    const trigger = (event.target as Element).closest?.("[data-nav-logo], [data-nav-product]")
    if (!trigger) return
    const product = trigger.hasAttribute("data-nav-product")
    // What would open a menu, held back from the browser as the menus do (no native menu, no scrolling).
    const opens =
      event instanceof KeyboardEvent
        ? event.key === "ContextMenu" || (event.shiftKey && event.key === "F10") || (product && event.key === "ArrowDown")
        : event.type === "contextmenu" && !product
    if (opens) event.preventDefault()
    const replay = opens || event instanceof PointerEvent
    if (early) return replay && early.push(event)
    const hint = product
      ? event.type === "pointerover" || event.type === "focusin"
      : event.type === "pointerdown" && (event as PointerEvent).pointerType === "touch"
    if (!opens && !hint) return
    early = replay ? [event] : []
    void import("@opencode/nav-menus").then(
      (module) => {
        if (stopped) return
        listen(false)
        // closeNavMenus is reassigned by installNavMenus, so it's read from the module when called.
        menus = { close: () => module.closeNavMenus(), stop: module.installNavMenus(options) }
        early?.forEach((event) => event.target?.dispatchEvent(new (event.constructor as typeof Event)(event.type, event)))
        early = undefined
      },
      () => (early = undefined),
    )
  }
  listen(true)

  return {
    /** Closes whichever nav menu is open; hosts call it when they open a menu of their own. */
    close: () => menus?.close(),
    stop: () => {
      stopped = true
      listen(false)
      menus?.stop()
    },
  }
}
