import { For } from "solid-js"
import { linkSegments } from "@opencode/util/link-segments"

/**
 * Plain text for use inside `<text>`, with every http(s) URL underlined as a hyperlink. The app's mouse handler opens
 * it on a plain click (see `clickedLink` in `./link`), and terminals with OSC 8 support open it on a modified click.
 */
export function LinkedText(props: { text: string }) {
  return (
    <For each={linkSegments(props.text)}>
      {(segment) =>
        segment.href ? (
          <a href={segment.href}>
            <u>{segment.text}</u>
          </a>
        ) : (
          segment.text
        )
      }
    </For>
  )
}
