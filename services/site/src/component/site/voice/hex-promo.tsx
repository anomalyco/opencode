import "./orb.css"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useI18n } from "~/context/i18n-context"
import { menuOpen, watchMenus } from "../menu-open"
import { prefersSheet } from "../sheet"
import type HexPanel from "./hex-panel"

/**
 * The orb for launch (voice mode is off, see flag.ts): the same resting orb in the bottom corner, and
 * a click or tap shows only voice mode's Hex section (hex-panel.tsx). The orb renders with the page;
 * the pop-up's code and styles load the first time it is hovered, focused or pressed.
 * No microphone, speech or voice API is involved, and none of voice mode's code loads.
 */
export default function HexPromo() {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const [Panel, setPanel] = createSignal<typeof HexPanel>()
  const sheetMode = prefersSheet()
  let orb!: HTMLButtonElement
  let toggle: (() => void) | undefined
  let loading: Promise<void> | undefined
  const load = () =>
    (loading ??= import("./hex-panel").then(
      (module) => void setPanel(() => module.default),
      () => void (loading = undefined),
    ))

  // Any other menu, sheet or Contents menu open (menu-open.ts sets data-menu-open on <html>): the
  // orb fades out and can't be focused (orb.css), and its own pop-up closes.
  onMount(() => onCleanup(watchMenus("[data-component='voice-mode']")))

  return (
    <div data-component="voice-mode" data-promo="">
      <Show when={Panel()}>
        {(component) => (
          <Dynamic
            component={component()}
            orb={orb}
            open={open()}
            setOpen={setOpen}
            toggle={(run: () => void) => (toggle = run)}
          />
        )}
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
        aria-controls={sheetMode || !Panel() ? undefined : "hex-promo"}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
        onPointerDown={() => void load()}
        onClick={() => {
          if (toggle) return toggle()
          // Pressed before the pop-up's code arrived: it opens once that has, two frames on, so it
          // animates in from its hidden state as it does later.
          void load().then(() => requestAnimationFrame(() => requestAnimationFrame(() => toggle?.())))
        }}
      >
        <span data-slot="disc" aria-hidden="true" />
        <svg data-slot="orb-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M1.375 6H2.625V10H1.375ZM4.375 4H5.625V12H4.375ZM7.375 2H8.625V14H7.375ZM10.375 4H11.625V12H10.375ZM13.375 6H14.625V10H13.375Z" />
        </svg>
      </button>
    </div>
  )
}
