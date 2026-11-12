import "./orb.css"
import { createSignal, onCleanup, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useI18n } from "~/context/i18n-context"
import { hexOrb } from "./hex-orb"
import type HexPanel from "./hex-panel"

/**
 * The orb for launch (voice mode is off, see flag.ts): the same resting orb in the bottom corner
 * (hex-orb.ts), and a click or tap shows only voice mode's Hex section (hex-panel.tsx). The orb
 * renders with the page; the pop-up's code and styles load the first time it is hovered, focused or
 * pressed. No microphone, speech or voice API is involved, and none of voice mode's code loads.
 */
export default function HexPromo() {
  const i18n = useI18n()
  const [Panel, setPanel] = createSignal<typeof HexPanel>()
  let toggle = () => {}
  const orb = hexOrb(i18n.t("site.hexPromo.label"), () =>
    import("./hex-panel").then((module) => {
      setPanel(() => module.default)
      return () => toggle()
    }),
  )
  onCleanup(orb.stop)

  return (
    <div data-component="voice-mode" data-promo="">
      <Show when={Panel()}>
        {(component) => <Dynamic component={component()} orb={orb.orb} toggle={(run: () => void) => (toggle = run)} />}
      </Show>
      {orb.orb}
    </div>
  )
}
