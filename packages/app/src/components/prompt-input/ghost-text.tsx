import { type Component, Show } from "solid-js"

type GhostTextProps = {
  text: string
}

/**
 * Displays ghost text as a completion hint below the input area.
 * The text appears dimmed/faded to indicate it's a suggestion.
 */
export const GhostText: Component<GhostTextProps> = (props) => {
  return (
    <Show when={props.text}>
      <div
        class="flex items-center gap-2 px-3 py-1 border-t border-border-base pointer-events-none select-none"
        aria-hidden="true"
      >
        <span class="text-14-regular flex-1 truncate text-text-subtle opacity-70">{props.text}</span>
        <span class="text-11-regular text-text-subtle shrink-0 opacity-60">Tab</span>
      </div>
    </Show>
  )
}
