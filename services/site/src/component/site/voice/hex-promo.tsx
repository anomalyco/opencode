import "./voice-mode.css"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { ExternalArrow, HexMark, NewTab } from "../icons"
import { menuOpen, watchMenus } from "../menu-open"
import { prefersSheet, Sheet, type SheetControl } from "../sheet"

/**
 * The orb for launch (voice mode is off, see flag.ts): the same resting orb in the bottom corner, and
 * a click or tap shows only voice mode's Hex section (the square icon, title, line and actions, as
 * they look in the voice panel), anchored to the orb on desktop and in a bottom sheet on touch phones.
 * No microphone, speech or voice API is involved, and none of voice mode's code loads.
 */

const hexUrl = "https://anoma.ly/hex"

export default function HexPromo() {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const sheetMode = prefersSheet()
  const title = () =>
    i18n.t(matchMedia("(pointer: coarse)").matches ? "site.hexPromo.titleDevice" : "site.hexPromo.titleComputer")
  let orb!: HTMLButtonElement
  let panel: HTMLElement | undefined
  let sheet: SheetControl | undefined

  const show = () => {
    if (sheetMode) return sheet?.open(orb)
    setOpen(true)
    queueMicrotask(() => panel?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true }))
  }
  const hide = (refocus = true) => {
    if (!open()) return
    setOpen(false)
    if (sheetMode) return sheet?.close()
    if (refocus) orb.focus({ preventScroll: true })
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open() || sheetMode) return
      event.preventDefault()
      hide()
    }
    const onPointer = (event: PointerEvent) => {
      if (!open() || sheetMode) return
      const target = event.target as Node
      if (panel?.contains(target) || orb.contains(target)) return
      // Back to the orb, unless the click lands on something that takes focus itself.
      hide(!(target instanceof Element && target.closest("a, button, input, textarea, select, [tabindex]")))
    }
    // Any other menu, sheet or Contents menu open (menu-open.ts sets data-menu-open on <html>): the
    // orb fades out and can't be focused (voice-mode.css), and its own pop-up closes.
    onCleanup(watchMenus("[data-component='voice-mode']"))
    // The sheet sets the orb's aria-expanded itself, and closes on a drag, a backdrop tap or Escape.
    const expanded = new MutationObserver(() => setOpen(orb.getAttribute("aria-expanded") === "true"))
    if (sheetMode) expanded.observe(orb, { attributes: true, attributeFilter: ["aria-expanded"] })
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer, true)
    onCleanup(() => {
      expanded.disconnect()
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer, true)
    })
  })

  createEffect(() => menuOpen() && hide(false))

  // Voice mode's Hex section, unchanged: the wrapper opens with its height and staggered parts.
  const section = () => (
    <div data-slot="hex-wrap" data-open={open() ? "" : undefined}>
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
    <div data-component="voice-mode" data-promo="">
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
            aria-hidden={open() ? undefined : "true"}
            inert={!open()}
            data-hidden={open() ? undefined : ""}
          >
            {section()}
          </section>
        }
      >
        <Sheet name="hex" label={i18n.t("site.hexPromo.label")} control={(control) => (sheet = control)}>
          {section()}
        </Sheet>
      </Show>

      <button
        ref={orb}
        type="button"
        data-slot="orb"
        data-shown=""
        tabIndex={menuOpen() ? -1 : 0}
        data-resting=""
        data-open={open() ? "" : undefined}
        aria-label={i18n.t("site.hexPromo.label")}
        aria-haspopup="dialog"
        aria-expanded={sheetMode ? "false" : open()}
        aria-controls={sheetMode ? undefined : "hex-promo"}
        onClick={() => (open() ? hide() : show())}
      >
        <span data-slot="disc" aria-hidden="true" />
        <svg data-slot="orb-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M1.375 6H2.625V10H1.375ZM4.375 4H5.625V12H4.375ZM7.375 2H8.625V14H7.375ZM10.375 4H11.625V12H10.375ZM13.375 6H14.625V10H13.375Z" />
        </svg>
      </button>
    </div>
  )
}
