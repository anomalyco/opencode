import HexPanel from "~/component/site/voice/hex-panel"
import { swap } from "../solid"

/**
 * The Hex promo's pop-up (hex-panel.tsx), rendered in front of the orb as hex-promo.tsx does, once
 * the orb is first hovered, focused or pressed (hex-orb.ts). Resolves with what a click on it does.
 */
export default async function hexPanel(orb: HTMLButtonElement) {
  let toggle = () => {}
  const spot = document.createElement("span")
  orb.before(spot)
  await swap(() => <HexPanel orb={orb} toggle={(run) => (toggle = run)} />, spot)
  return () => toggle()
}
