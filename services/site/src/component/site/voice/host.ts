import { type Component, createRoot, getOwner } from "solid-js"
import { createComponent, insert } from "solid-js/web"
import { voiceMode } from "./flag"
import HexPromo from "./hex-promo"
import { setVoicePhase } from "./state"

// The orb (voice mode, or for launch the Hex promo) lives outside the pages: it is rendered once, into a host element that each page's site
// root adopts as it mounts. A client-side navigation moves the same element (and the same running
// voice mode, microphone and all) into the new page instead of starting a new one.
let host: HTMLDivElement | undefined

export function adoptVoice(site: HTMLElement) {
  if (!host) {
    host = document.createElement("div")
    host.dataset.voiceHost = ""
    host.style.display = "contents"
    const target = host
    // Its own root, so a page change never disposes it, but under the caller's owner, so it still
    // sees the app's providers (language, i18n) that wrap every page. The root function takes
    // `dispose`: Solid gives a root whose function takes no arguments no owner, and so no context.
    const owner = getOwner()
    const mount = (component: Component) =>
      createRoot((_dispose) => insert(target, createComponent(component, {})), owner)
    // With voice mode off (flag.ts) the Hex promo's orb renders with the page (its pop-up loads on
    // intent); voice mode's code never loads.
    if (voiceMode) void import("./voice-mode").then((module) => mount(module.default))
    if (!voiceMode) mount(HexPromo)
  }
  if (host.parentElement !== site) site.appendChild(host)
}

/** Settings › Voice orb off: take it out of the page and end any session. */
export function dropVoice() {
  setVoicePhase("closed")
  host?.remove()
}
