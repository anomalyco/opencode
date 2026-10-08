import { createSignal, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"

/**
 * A page's icon, or the globe while it has none or its image fails to decode. Clicks pass through to what holds it, so
 * the address field focuses from its icon too.
 */
export function PageIcon(props: { icon: string | undefined; class?: string }) {
  // The icon that failed; a new icon for the page is tried again.
  const [broken, setBroken] = createSignal<string>()

  return (
    <Show
      when={props.icon !== broken() ? props.icon : undefined}
      fallback={<Icon name="outline-globe" class={`pointer-events-none size-4 shrink-0 ${props.class ?? ""}`} />}
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
