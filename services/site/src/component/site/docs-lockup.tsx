import "./docs-lockup.css"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { docsProducts } from "~/lib/docs-content"
import { docsUrl, v1DocsUrl } from "~/lib/docs"
import { Chevron, ExternalArrow } from "./icons"
import { fanMotion } from "./fan-motion"
import { onCloseMenus } from "./menu-open"
import { siteSettings } from "./settings"
import { inlineKey, isRtl } from "~/lib/direction"

export const docsVersions = [
  { id: "latest", label: "V2", meta: "(latest)" },
  { id: "v1", label: "V1" },
] as const

export type DocsVersion = (typeof docsVersions)[number]["id"]

type Item = {
  id: string
  label: string
  meta?: string
  ariaLabel: string
  href: string
  /** A child menu: a flyout beside the row on desktop, rows under it on phones. */
  sub?: { label: string; items: Item[]; current: string; onSelect?: (id: string) => void }
  /** Leaves the site, with the nav's external arrow. */
  external?: boolean
}

/**
 * Settings › Docs switcher › lockup: the docs section word after the site's logo, like the Data and
 * Console headers (public/nav-demo/switcher.js). One button opens a menu of the docs sections, where
 * "Docs" has a submenu of versions. On an older version, "/ V1" after the word shows it and switches
 * back.
 */
export function DocsLockup(props: {
  current: string
  /** Demo only: link the sections elsewhere and switch them in place instead of navigating. */
  href?: (label: string) => string
  onSelect?: (label: string) => void
  /** Demo only: the docs versions. */
  version?: {
    current: DocsVersion
    href: (id: DocsVersion) => string
    onSelect: (id: DocsVersion) => void
  }
}) {
  const name = (label: string) => (label === "Docs" ? label : `${label} docs`)
  // V1 is a version, not a section: "Docs" has a submenu of versions, V2 (these docs) and V1 (the old
  // docs site). The /docs demo can pass its own (?version= switches in place).
  const sections = () => docsProducts.filter((product) => product.label !== "V1")
  const defaultVersions: Item[] = [
    { id: "latest", label: "V2", meta: "(latest)", ariaLabel: "Latest docs", href: docsUrl() },
    { id: "v1", label: "V1", ariaLabel: "V1 docs", href: v1DocsUrl() },
  ]
  const versionItems = (version: NonNullable<typeof props.version>) =>
    docsVersions.map((item) => ({
      id: item.id,
      label: item.label,
      meta: "meta" in item ? item.meta : undefined,
      ariaLabel: item.id === "latest" ? "Latest docs" : "V1 docs",
      href: version.href(item.id),
    }))
  // The lockup lives beside the logo: in the sidebar, so it scrolls away with it at the end of the
  // page, or on phones in the top bar, so it stays above the page like the bar.
  const [host, setHost] = createSignal<HTMLElement>()
  onMount(() => {
    const phone = window.matchMedia("(max-width: 60rem)")
    const place = () =>
      setHost(
        document.querySelector<HTMLElement>(
          phone.matches ? '[data-component="topbar"]' : '[data-component="sidebar"]',
        ) ?? undefined,
      )
    place()
    phone.addEventListener("change", place)
    onCleanup(() => phone.removeEventListener("change", place))
  })

  return (
    <Show when={host()} keyed>
      {(mount) => (
        <Portal
          mount={mount}
          ref={(element) => {
            element.style.display = "contents"
            // First in its host, so the sidebar's last child stays the nav that scrolls under the logo.
            queueMicrotask(() => mount.prepend(element))
          }}
        >
          <div data-component="docs-lockup">
            <Dropdown
              id="docs-lockup-menu"
              menuLabel="Docs"
              trigger={(label) => name(label)}
              triggerLabel={(label) => `${name(label)}, switch docs`}
              items={sections().map((product) => ({
                id: product.label,
                label: product.label,
                ariaLabel: name(product.label),
                href: props.href?.(product.label) ?? product.href,
                sub:
                  product.label !== "Docs"
                    ? undefined
                    : props.version
                      ? {
                          label: "Docs version",
                          items: versionItems(props.version),
                          current: props.version.current,
                          onSelect: (id: string) => props.version?.onSelect(id as DocsVersion),
                        }
                      : { label: "Docs version", items: defaultVersions, current: "latest" },
              }))}
              current={props.current}
              onSelect={props.onSelect}
              split={{ label: "Switch docs", onSelect: props.onSelect }}
            />
            {/* Only the main docs have versions, and only an older one shows here. */}
            <Show when={props.current === "Docs" && props.version?.current !== "latest" && props.version}>
              {(version) => (
                <>
                  <span data-slot="separator" aria-hidden="true">
                    |
                  </span>
                  <Dropdown
                    id="docs-version-menu"
                    variant="version"
                    menuLabel="Docs version"
                    trigger={(id) => docsVersions.find((item) => item.id === id)!.label}
                    triggerLabel={(id) => `${docsVersions.find((item) => item.id === id)!.label}, switch docs version`}
                    items={versionItems(version())}
                    current={version().current}
                    onSelect={(id) => version().onSelect(id as DocsVersion)}
                  />
                </>
              )}
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function Dropdown(props: {
  id: string
  variant?: "version"
  menuLabel: string
  trigger: (id: string) => string
  triggerLabel: (id: string) => string
  items: Item[]
  current: string
  onSelect?: (id: string) => void
  /** Settings › Docs nav › split: the word links to the section's home; `label` names the chevron. */
  split?: { label: string; onSelect?: (id: string) => void }
}) {
  const [open, setOpen] = createSignal(false)
  const [subOpen, setSubOpen] = createSignal(false)
  // On phones the menu is a full-width sheet; its labels are indented to the trigger's text.
  const [textX, setTextX] = createSignal(0)
  const items: HTMLAnchorElement[] = []
  const subItems: HTMLAnchorElement[] = []
  let root: HTMLDivElement | undefined
  let menu: HTMLDivElement | undefined
  let combined: HTMLButtonElement | undefined
  let word: HTMLAnchorElement | undefined
  let toggleButton: HTMLButtonElement | undefined
  // Both forms render; Settings › Docs nav shows one (docs-lockup.css), so use whichever is shown.
  const splitShown = () => !!toggleButton && toggleButton.offsetParent !== null
  const button = () => (splitShown() ? toggleButton : combined)
  const currentIndex = () =>
    Math.max(
      props.items.findIndex((item) => item.id === props.current),
      0,
    )

  const show = (focus?: number) => {
    // The trigger's text start from the window's inline-start edge: its left, or right to left the
    // distance from its right edge to the window's.
    const trigger = splitShown() ? word : combined
    const box = trigger?.getBoundingClientRect()
    setTextX((box && trigger ? (isRtl(trigger) ? document.documentElement.clientWidth - box.right : box.left) : 0) + 6)
    setNested(
      siteSettings.docsSubmenu === "nested" ||
        window.matchMedia("(max-width: 60rem), (hover: none), (pointer: coarse)").matches,
    )
    setOpen(true)
    fan()
    if (focus !== undefined) items[(focus + props.items.length) % props.items.length]?.focus()
  }
  const close = (refocus?: boolean) => {
    setOpen(false)
    setSubOpen(false)
    if (refocus) button()?.focus()
  }
  onCloseMenus(() => close())
  const toggle = () => (open() ? close() : show())
  const triggerKeys = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      show(currentIndex())
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      show(props.items.length - 1)
    }
    if (event.key === "Escape" && open()) close(true)
  }
  // Settings › Section menu › fan: the rows spring out one after another with the logo fan's motion
  // (logo-fan.tsx). Beside the sidebar only; the phone sheet and reduced motion just appear.
  const fan = () => {
    if (siteSettings.sectionMenuStyle !== "fan" || !menu) return
    if (window.matchMedia("(max-width: 60rem), (prefers-reduced-motion: reduce)").matches) return
    ;([...menu.children] as HTMLElement[]).forEach((row, index) => {
      const timing = { delay: index * fanMotion.stagger, fill: "backwards" as const }
      row.animate([{ transform: fanMotion.start(index) }, { transform: fanMotion.rest }], {
        ...timing,
        duration: 450,
        easing: fanMotion.spring,
      })
      row.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, duration: 140, easing: "ease-out" })
    })
  }
  // The chosen page's content takes focus once it shows (site.tsx), not the trigger.
  const select = (event: MouseEvent, onSelect: ((id: string) => void) | undefined, id: string) => {
    close()
    if (!onSelect) return
    event.preventDefault()
    onSelect(id)
  }
  // Leaving "Docs" closes its flyout after a moment, so the pointer can cut across the next row on
  // its way into the flyout.
  let subTimer: ReturnType<typeof setTimeout> | undefined
  // Settings › Docs submenu: a flyout beside the menu, or the versions nested under "Docs", where
  // "›" expands and collapses them. Touch and narrow screens always nest: a hover flyout can't be
  // reached by touch, and a phone's sheet has no room beside it.
  const [nested, setNested] = createSignal(false)
  onCleanup(() => clearTimeout(subTimer))
  const openSub = (sub: NonNullable<Item["sub"]>, focus: boolean) => {
    clearTimeout(subTimer)
    setSubOpen(true)
    if (!focus) return
    const index = sub.items.findIndex((item) => item.id === sub.current)
    subItems[Math.max(index, 0)]?.focus()
  }

  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (open() && !root?.contains(event.target as Node)) close()
    }
    document.addEventListener("pointerdown", outside)
    onCleanup(() => document.removeEventListener("pointerdown", outside))
  })

  return (
    <div ref={root} data-slot="dropdown" data-variant={props.variant} data-split={props.split ? "" : undefined}>
      <button
        ref={combined}
        type="button"
        data-slot="trigger"
        data-design={props.split ? "docsNav sectionMenuStyle menuActive menuColor menuAlign docsSubmenu" : undefined}
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={props.id}
        aria-label={props.triggerLabel(props.items[currentIndex()].id)}
        onClick={toggle}
        onKeyDown={triggerKeys}
      >
        {props.trigger(props.items[currentIndex()].id)}
        <Chevron />
      </button>
      {/* Settings › Docs nav › split: like the Data and Console headers (public/nav-demo), the word
          goes to the current section's home and the chevron alone opens the menu. site.css-free:
          docs-lockup.css shows one form or the other from the root's data-docs-nav. */}
      <Show when={props.split}>
        {(split) => (
          <>
            <a
              ref={word}
              data-slot="word"
              data-design="docsNav sectionMenuStyle menuActive menuColor menuAlign docsSubmenu"
              href={props.items[currentIndex()].href}
              aria-label={`${props.trigger(props.items[currentIndex()].id)} home`}
              onClick={(event) => {
                close()
                if (!split().onSelect) return
                event.preventDefault()
                split().onSelect?.(props.items[currentIndex()].id)
              }}
            >
              {props.trigger(props.items[currentIndex()].id)}
            </a>
            <button
              ref={toggleButton}
              type="button"
              data-slot="toggle"
              aria-haspopup="menu"
              aria-expanded={open() ? "true" : "false"}
              aria-controls={props.id}
              aria-label={split().label}
              onClick={toggle}
              onKeyDown={triggerKeys}
            >
              <Chevron />
            </button>
          </>
        )}
      </Show>
      <Show when={open()}>
        <div
          ref={menu}
          data-slot="menu"
          id={props.id}
          role="menu"
          aria-label={props.menuLabel}
          data-submenu={nested() ? "nested" : "flyout"}
          style={{ "--menu-text": `${textX()}px` }}
          onKeyDown={(event) => {
            // Nested versions are rows of this menu, so the arrows walk through them in place.
            const rows = nested()
              ? [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')]
              : items
            const row = rows.indexOf(document.activeElement as HTMLAnchorElement)
            const moves: Record<string, number> = {
              ArrowDown: row + 1,
              ArrowUp: row - 1,
              Home: 0,
              End: rows.length - 1,
            }
            if (event.key in moves) {
              event.preventDefault()
              if (!nested()) setSubOpen(false)
              rows[(moves[event.key] + rows.length) % rows.length].focus()
            }
            const at = items.indexOf(document.activeElement as HTMLAnchorElement)
            const sub = props.items[at]?.sub
            if (inlineKey(event) === "ArrowRight" && sub) {
              event.preventDefault()
              openSub(sub, true)
            }
            if (inlineKey(event) === "ArrowLeft" && sub && subOpen()) {
              event.preventDefault()
              setSubOpen(false)
            }
            if (event.key === "Escape") {
              event.preventDefault()
              close(true)
            }
            if (event.key === "Tab") close()
          }}
        >
          <For each={props.items}>
            {(item, index) => (
              <Show
                when={item.sub}
                fallback={
                  <Row
                    item={item}
                    ref={(element) => (items[index()] = element)}
                    current={index() === currentIndex()}
                    onClick={(event) => select(event, props.onSelect, item.id)}
                  />
                }
              >
                {(sub) => (
                  <div
                    role="none"
                    data-slot="parent"
                    data-open={subOpen() ? "" : undefined}
                    onPointerEnter={(event) => event.pointerType === "mouse" && !nested() && openSub(sub(), false)}
                    onPointerLeave={(event) => {
                      if (event.pointerType !== "mouse") return
                      clearTimeout(subTimer)
                      subTimer = setTimeout(() => setSubOpen(false), 300)
                    }}
                  >
                    <Row
                      item={item}
                      ref={(element) => (items[index()] = element)}
                      current={index() === currentIndex()}
                      expanded={subOpen()}
                      onClick={(event) => select(event, props.onSelect, item.id)}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      data-slot="expand"
                      aria-label={sub().label}
                      aria-expanded={subOpen() ? "true" : "false"}
                      onClick={() => (subOpen() && nested() ? setSubOpen(false) : openSub(sub(), false))}
                    >
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path
                          d="M4.5 3L7.5 6L4.5 9"
                          stroke="currentColor"
                          stroke-width="1.25"
                          stroke-linecap="square"
                        />
                      </svg>
                    </button>
                    <Show when={subOpen()}>
                      <div
                        data-slot="submenu"
                        role="menu"
                        aria-label={sub().label}
                        onKeyDown={(event) => {
                          if (nested() && inlineKey(event) !== "ArrowLeft" && event.key !== "Escape") return
                          event.stopPropagation()
                          const at = subItems.indexOf(document.activeElement as HTMLAnchorElement)
                          const count = sub().items.length
                          const moves: Record<string, number> = {
                            ArrowDown: at + 1,
                            ArrowUp: at - 1,
                            Home: 0,
                            End: count - 1,
                          }
                          if (event.key in moves) {
                            event.preventDefault()
                            subItems[(moves[event.key] + count) % count].focus()
                          }
                          if (inlineKey(event) === "ArrowLeft" || event.key === "Escape") {
                            event.preventDefault()
                            setSubOpen(false)
                            items[index()].focus()
                          }
                          if (event.key === "Tab") close()
                        }}
                      >
                        <For each={sub().items}>
                          {(child, childIndex) => (
                            <Row
                              item={child}
                              ref={(element) => (subItems[childIndex()] = element)}
                              current={child.id === sub().current}
                              onClick={(event) => select(event, sub().onSelect, child.id)}
                            />
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function Row(props: {
  item: Item
  ref: (element: HTMLAnchorElement) => void
  current: boolean
  expanded?: boolean
  onClick: (event: MouseEvent) => void
}) {
  return (
    <a
      ref={props.ref}
      role="menuitem"
      tabIndex={-1}
      href={props.item.href}
      aria-current={props.current ? "page" : undefined}
      aria-label={props.item.ariaLabel}
      aria-haspopup={props.item.sub ? "menu" : undefined}
      aria-expanded={props.item.sub ? (props.expanded ? "true" : "false") : undefined}
      onClick={props.onClick}
    >
      <span data-slot="label">
        {props.item.label}
        <Show when={props.item.meta}>
          <span data-slot="meta">{props.item.meta}</span>
        </Show>
        <Show when={props.item.external}>
          <ExternalArrow />
        </Show>
      </span>
      <Show when={props.current}>
        <svg data-slot="check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </Show>
    </a>
  )
}
