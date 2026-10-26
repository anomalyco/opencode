import { Index, Show, createMemo } from "solid-js"
import { linkSegments } from "./link-segments"

/** Plain text with every http(s) URL rendered as a link that opens outside the app. */
export function LinkedText(props: { text: string }) {
  const segments = createMemo(() => linkSegments(props.text))

  return (
    <Index each={segments()}>
      {(segment) => (
        <Show when={segment().href} fallback={segment().text}>
          {(href) => (
            <a data-slot="linked-text-link" href={href()} target="_blank" rel="noopener noreferrer">
              {segment().text}
            </a>
          )}
        </Show>
      )}
    </Index>
  )
}
