import "./product-lockup.css"
import "@opencode/nav-menus/nav-menus.css"
import { installNavMenus } from "@opencode/nav-menus"
import { onCleanup, onMount } from "solid-js"

/**
 * The OpenCode lockup, as on opencode.ai and the Console: the OpenCode mark, linking to the site's home (right-click
 * for the logo menu), then DATA, linking to the Data home (hover, or its chevron on touch screens, for the product
 * menu). The menus are the shared ones in packages/nav-menus.
 */
export function ProductLockup(props: {
  href: string
  nameLabel: string
  homeLabel: string
  link: (path: string) => string
}) {
  onMount(() => onCleanup(installNavMenus({ link: props.link })))

  return (
    <div data-component="product-lockup" data-nav-lockup>
      <a
        data-nav-logo
        href={props.link("/")}
        aria-label={props.homeLabel}
        title={props.homeLabel}
        aria-haspopup="menu"
        aria-expanded="false"
      >
        <svg viewBox="0 0 240 300" fill="none" aria-hidden="true">
          <path data-part="inner" d="M180 240H60V120H180V240Z" />
          <path data-part="code" d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" />
        </svg>
      </a>
      <a
        data-nav-product="data"
        href={props.href}
        aria-label={props.nameLabel}
        aria-haspopup="menu"
        aria-expanded="false"
      >
        Data
      </a>
    </div>
  )
}
