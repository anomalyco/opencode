import { createSignal, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"

/**
 * A page's icon, or the globe while it has none or its image fails to decode. Only a PNG is drawn, which is what main
 * makes of a site's icon: an SVG that an earlier version stored draws the globe until the page reports its icon again.
 * Clicks pass through to what holds it, so the address field focuses from its icon too.
 */
export function PageIcon(props: { icon: string | undefined; class?: string }) {
  // The icon that failed; a new icon for the page is tried again.
  const [broken, setBroken] = createSignal<string>()

  return (
    <Show
      when={props.icon !== broken() && props.icon?.startsWith("data:image/png;base64,") ? props.icon : undefined}
      fallback={<Icon name="globe" class={`pointer-events-none size-4 shrink-0 ${props.class ?? ""}`} />}
    >
      {(icon) => (
        <img
          src={icon()}
          alt=""
          class="pointer-events-none size-4 shrink-0 object-contain"
          onError={() => setBroken(icon())}
        />
      )}
    </Show>
  )
}
