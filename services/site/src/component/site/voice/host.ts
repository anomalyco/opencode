import { createRoot, getOwner } from "solid-js"
import { createComponent, insert } from "solid-js/web"
import { voiceMode } from "./flag"
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
    // With voice mode off (flag.ts) only the small Hex promo loads; voice mode's code never does.
    void (voiceMode ? import("./voice-mode") : import("./hex-promo")).then((module) =>
      createRoot((_dispose) => insert(target, createComponent(module.default, {})), owner),
    )
  }
  if (host.parentElement !== site) site.appendChild(host)
}

/** Settings › Voice orb off: take it out of the page and end any session. */
export function dropVoice() {
  setVoicePhase("closed")
  host?.remove()
}
