import { For, Show, createSignal, createUniqueId, onCleanup, onMount, type JSX } from "solid-js"
import { ExternalArrow, NewTab } from "./icons"
import { onCloseMenus } from "./menu-open"
import { placeMenu } from "./place-menu"
import { Sheet, prefersSheet, type SheetControl } from "./sheet"

/** One row: a link, with the external arrow and a new-tab note when it opens in a new tab. */
export type SiteMenuItem = { label: string; href: string; external?: boolean }

/**
 * The site's dropdown: a trigger and a menu of links in the shared menu look (site.css's
 * `site-menu`: rows edge to edge, the grey hover tint and the bar on the left, the popover colours,
 * shadow and opening animation). It opens where it fits (placeMenu), from the trigger's start or end edge.
 * Arrow keys, Home and End move between rows; Escape and a click outside close it and Escape gives
 * focus back to the trigger; opened from the keyboard, focus moves to the first row. On a touch
 * phone the trigger opens the site's bottom sheet (sheet.tsx) instead. Every dropdown uses this.
 */
export function SiteMenu(props: {
  /** The trigger's content, such as its label and a chevron. */
  trigger: JSX.Element
  /** The menu's accessible name. */
  label: string
  items: SiteMenuItem[]
  align?: "start" | "end"
}) {
  const [open, setOpen] = createSignal(false)
  const [sheet, setSheet] = createSignal(false)
  const id = createUniqueId()
  let root!: HTMLDivElement
  let trigger!: HTMLButtonElement
  let sheetControl: SheetControl | undefined
  onCloseMenus(() => setOpen(false))

  onMount(() => {
    setSheet(prefersSheet())
    const outside = (event: PointerEvent) => {
      if (open() && !root.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open()) return
      setOpen(false)
      trigger.focus()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
    })
  })

  const rows = () => [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')]

  const toggle = (event: MouseEvent) => {
    if (sheet() && sheetControl) return sheetControl.open(trigger)
    setOpen(!open())
    const menu = root.querySelector<HTMLElement>('[data-slot="menu"]')
    if (menu) placeMenu(menu)
    if (open() && event.detail === 0) rows()[0]?.focus({ preventScroll: true })
  }

  const move = (event: KeyboardEvent) => {
    const list = rows()
    const index = list.indexOf(document.activeElement as HTMLElement)
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    list[(next + list.length) % list.length]?.focus()
  }

  const external = (item: SiteMenuItem) =>
    item.external ? { target: "_blank", rel: "noopener noreferrer" } : { target: undefined, rel: undefined }

  return (
    <div ref={root} data-component="site-menu" data-align={props.align ?? "start"}>
      <button
        ref={trigger}
        type="button"
        data-slot="trigger"
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={id}
        onClick={toggle}
      >
        {props.trigger}
      </button>
      <Show when={open()}>
        <div data-slot="menu" id={id} role="menu" aria-label={props.label} onKeyDown={move}>
          <For each={props.items}>
            {(item) => (
              <a data-slot="link" role="menuitem" href={item.href} {...external(item)} onClick={() => setOpen(false)}>
                <span data-slot="link-label">
                  {item.label}
                  <Show when={item.external}>
                    <ExternalArrow />
                  </Show>
                </span>
                <Show when={item.external}>
                  <NewTab />
                </Show>
              </a>
            )}
          </For>
        </div>
      </Show>
      <Show when={sheet()}>
        <Sheet name="menu" label={props.label} control={(control) => (sheetControl = control)}>
          <ul>
            <For each={props.items}>
              {(item) => (
                <li>
                  <a data-slot="row" href={item.href} {...external(item)} on:click={() => sheetControl?.close()}>
                    <span data-slot="link-label">
                      {item.label}
                      <Show when={item.external}>
                        <ExternalArrow />
                      </Show>
                    </span>
                    <Show when={item.external}>
                      <NewTab />
                    </Show>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </Sheet>
      </Show>
    </div>
  )
}
