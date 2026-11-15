import { createSignal, Show } from "solid-js"
import type { SiteIconMode } from "./experiment"

// The project avatar colours, so a site's tile reads like the rest of the app's letter tiles in light and dark.
const colors = ["orange", "yellow", "cyan", "green", "red", "pink", "blue", "purple"]

// Hosts whose favicon failed this session, so every later tile for them shows its letter at once.
const failed = new Set<string>()

/** A site's letter tile, or with `site` its own favicon over the tile, falling back to the letter if that fails. */
export function SiteIcon(props: { site: string; host: string; mode: SiteIconMode }) {
  const [state, setState] = createSignal<"loading" | "loaded" | "failed">(failed.has(props.host) ? "failed" : "loading")
  const favicon = () => props.mode === "site" && state() !== "failed"

  return (
    <span
      data-component="site-icon"
      data-state={favicon() ? state() : undefined}
      aria-hidden="true"
      style={{
        "--site-icon-bg": `var(--v2-avatar-bg-${colors[hash(props.site) % colors.length]})`,
      }}
    >
      <Show when={favicon()} fallback={letter(props.site)}>
        <img
          data-slot="site-icon-image"
          src={`https://${props.host}/favicon.ico`}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth > 0) return setState("loaded")
            failed.add(props.host)
            setState("failed")
          }}
          onError={() => {
            failed.add(props.host)
            setState("failed")
          }}
        />
      </Show>
    </span>
  )
}

function letter(site: string) {
  return Array.from(site)[0]?.toUpperCase() ?? ""
}

// FNV-1a, so a site keeps its colour everywhere it shows.
function hash(value: string) {
  return Array.from(value).reduce((sum, char) => Math.imul(sum ^ char.codePointAt(0)!, 16777619) >>> 0, 2166136261)
}
