import "./phone-menu.css"
import type { JSX } from "solid-js"
import { useI18n } from "~/context/i18n"

/**
 * The small-screen header's menu button and the sheet it opens, shared by the site's top bar
 * (site.tsx) and the 404 arcade (arcade/chrome.tsx). The caller owns the open state, Escape and
 * returning focus to the button; the sheet closes itself on its backdrop and on a chosen link.
 */
export function MenuToggle(props: { open: boolean; onToggle: () => void; ref?: (element: HTMLButtonElement) => void }) {
  const i18n = useI18n()
  return (
    <button
      ref={props.ref}
      type="button"
      data-component="menu-toggle"
      aria-expanded={props.open ? "true" : "false"}
      aria-controls="site-menu"
      aria-label={props.open ? i18n.t("site.closeMenu") : i18n.t("nav.openMenu")}
      onClick={() => props.onToggle()}
    >
      <span data-slot="line" />
      <span data-slot="line" />
    </button>
  )
}

export function MenuSheet(props: {
  open: boolean
  onClose: () => void
  children: JSX.Element
  listRef?: (element: HTMLUListElement) => void
  sortable?: boolean
}) {
  const i18n = useI18n()
  return (
    <div data-component="site-menu-sheet" id="site-menu" data-open={props.open ? "" : undefined}>
      <div data-slot="backdrop" onClick={() => props.onClose()} />
      <nav
        data-slot="panel"
        aria-label={i18n.t("site.landmark.primary")}
        onClick={(event) => {
          if ((event.target as Element).closest("a")) props.onClose()
        }}
      >
        <ul ref={props.listRef} data-sortable={props.sortable ? "" : undefined}>
          {props.children}
        </ul>
      </nav>
    </div>
  )
}
