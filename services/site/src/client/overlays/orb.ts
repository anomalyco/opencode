import { hexOrb } from "~/component/site/voice/hex-orb"
import { site, t } from "../dom"

/**
 * The corner orb (voice/host.ts on the hydrated pages): the Hex promo's orb at rest, with no
 * framework code; its pop-up loads on intent (hex-panel.tsx).
 */
export default function mountOrb() {
  const root = document.createElement("div")
  root.dataset.component = "voice-mode"
  root.dataset.promo = ""
  const orb = hexOrb(t("site.hexPromo.label"), () => import("./hex-panel").then((module) => module.default(orb.orb)))
  root.append(orb.orb)
  site.append(root)
}
