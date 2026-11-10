import "./voice-mode.css"
import { createEffect, onCleanup, onMount, type Setter, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { ExternalArrow, HexMark, NewTab } from "../icons"
import { menuOpen } from "../menu-open"
import { prefersSheet, Sheet, type SheetControl } from "../sheet"

const hexUrl = "https://anoma.ly/hex"

/**
 * The Hex promo's pop-up (hex-promo.tsx): voice mode's Hex section (the square icon, title, line and
 * actions, as they look in the voice panel), anchored to the orb on desktop and in a bottom sheet on
 * touch phones. Its code and voice-mode.css load once the orb is hovered, focused or pressed.
 */
export default function HexPanel(props: {
  orb: HTMLButtonElement
  open: boolean
  setOpen: Setter<boolean>
  /** Hands the orb what its click does. */
  toggle: (run: () => void) => void
}) {
  const i18n = useI18n()
  const sheetMode = prefersSheet()
  const title = () =>
    i18n.t(matchMedia("(pointer: coarse)").matches ? "site.hexPromo.titleDevice" : "site.hexPromo.titleComputer")
  let panel: HTMLElement | undefined
  let sheet: SheetControl | undefined

  const show = () => {
    if (sheetMode) return sheet?.open(props.orb)
    props.setOpen(true)
    queueMicrotask(() => panel?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true }))
  }
  const hide = (refocus = true) => {
    if (!props.open) return
    props.setOpen(false)
    if (sheetMode) return sheet?.close()
    if (refocus) props.orb.focus({ preventScroll: true })
  }
  props.toggle(() => (props.open ? hide() : show()))

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !props.open || sheetMode) return
      event.preventDefault()
      hide()
    }
    const onPointer = (event: PointerEvent) => {
      if (!props.open || sheetMode) return
      const target = event.target as Node
      if (panel?.contains(target) || props.orb.contains(target)) return
      // Back to the orb, unless the click lands on something that takes focus itself.
      hide(!(target instanceof Element && target.closest("a, button, input, textarea, select, [tabindex]")))
    }
    // The sheet sets the orb's aria-expanded itself, and closes on a drag, a backdrop tap or Escape.
    const expanded = new MutationObserver(() => props.setOpen(props.orb.getAttribute("aria-expanded") === "true"))
    if (sheetMode) expanded.observe(props.orb, { attributes: true, attributeFilter: ["aria-expanded"] })
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer, true)
    onCleanup(() => {
      expanded.disconnect()
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer, true)
    })
  })

  // Another menu opening closes the pop-up (hex-promo.tsx fades the orb).
  createEffect(() => menuOpen() && hide(false))

  // Voice mode's Hex section, unchanged: the wrapper opens with its height and staggered parts.
  const section = () => (
    <div data-slot="hex-wrap" data-open={props.open ? "" : undefined}>
      <div data-slot="hex-clip">
        <aside data-slot="hex-sell" aria-label="Hex">
          {/* The product list's tile: the flat white Hex mark on a black square. */}
          <span data-slot="hex-tile" aria-hidden="true">
            <HexMark />
          </span>
          <div>
            <p data-slot="hex-title">{title()}</p>
            <p data-slot="hex-body">{i18n.t("site.hexPromo.body")}</p>
          </div>
          <div data-slot="hex-actions">
            <a data-slot="hex-get" href={hexUrl} target="_blank" rel="noopener" onClick={() => hide(false)}>
              {i18n.t("site.hexPromo.get")} <ExternalArrow />
              <NewTab />
            </a>
            <button type="button" data-slot="hex-later" onClick={() => hide()}>
              {i18n.t("site.hexPromo.later")}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )

  return (
    <Show
      when={sheetMode}
      fallback={
        <section
          ref={panel}
          id="hex-promo"
          role="dialog"
          aria-label={i18n.t("site.hexPromo.label")}
          data-slot="popover"
          data-explainer=""
          data-promo-panel=""
          aria-hidden={props.open ? undefined : "true"}
          inert={!props.open}
          data-hidden={props.open ? undefined : ""}
        >
          {section()}
        </section>
      }
    >
      <Sheet name="hex" label={i18n.t("site.hexPromo.label")} control={(control) => (sheet = control)}>
        {section()}
      </Sheet>
    </Show>
  )
}
