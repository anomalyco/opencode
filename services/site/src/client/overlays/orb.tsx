import HexPromo from "~/component/site/voice/hex-promo"
import { site } from "../dom"
import { mount } from "../solid"

/** The corner orb (voice/host.ts on the hydrated pages): the Hex promo, its pop-up loading on intent. */
export default function mountOrb() {
  const host = document.createElement("div")
  host.dataset.voiceHost = ""
  host.style.display = "contents"
  site.append(host)
  return mount(() => <HexPromo />, host)
}
