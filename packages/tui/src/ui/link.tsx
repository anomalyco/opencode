import { For, Show, type JSX } from "solid-js"
import type { CliRenderer, MouseEvent, RGBA } from "@opentui/core"
import { openUrl } from "@opencode/util/open"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
  bg?: RGBA
  width?: number | "auto" | `${number}%`
  wrapMode?: "word" | "none"
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    <text
      fg={props.fg}
      bg={props.bg}
      width={props.width}
      wrapMode={props.wrapMode}
      onMouseUp={() => {
        openUrl(props.href).catch(() => {})
      }}
    >
      <a href={props.href}>{displayText}</a>
    </text>
  )
}

/**
 * Returns the hyperlink under a plain left click. opentui marks the release that ends a selection gesture with
 * `isDragging`, and a fresh "cell" selection means the pointer never moved; other releases, such as the end of a drag
 * that started outside text, are not clicks. Each rendered cell stores its full URL, so a click on any row of a wrapped
 * link resolves the whole link. Modified clicks are left to the terminal's own hyperlink handling.
 */
export function clickedLink(renderer: CliRenderer, event: MouseEvent) {
  if (!plainClick(renderer, event)) return
  return renderer.getLinkAt(event.x, event.y) ?? undefined
}

export function plainClick(renderer: CliRenderer, event: MouseEvent) {
  if (!event.isDragging || event.modifiers.ctrl || event.modifiers.alt || event.modifiers.shift) return false
  const selection = renderer.getSelection()
  return selection?.isStart === true && selection.behavior === "cell"
}

/**
 * Splits plain text into literal segments and bare `http(s)://` URLs. A URL ends at whitespace or `<`/`>`, and does not
 * start in the middle of a word. Sentence punctuation and Markdown emphasis after a URL stay plain text, and a closing
 * parenthesis or bracket only belongs to the URL when it has an opening one.
 */
export function linkify(text: string) {
  // The capture group makes split return the URLs at odd indexes.
  return text.split(/((?<!\w)https?:\/\/[^\s<>]+)/).flatMap((part, index) => {
    if (index % 2 === 0) return part ? [{ text: part }] : []
    const href = trimUrl(part)
    // Punctuation-only remainder such as "https://." is not a link.
    if (!/\/\/./.test(href)) return [{ text: part }]
    return [{ text: href, href }, ...(href.length < part.length ? [{ text: part.slice(href.length) }] : [])]
  })
}

const openers: Record<string, string> = { ")": "(", "]": "[" }

function trimUrl(url: string): string {
  const trimmed = url.replace(/[.,;:!?'"*]+$/, "")
  const closer = trimmed.at(-1) ?? ""
  const opener = openers[closer]
  if (opener && trimmed.split(closer).length > trimmed.split(opener).length) return trimUrl(trimmed.slice(0, -1))
  return trimmed
}

/**
 * Renders text as written, with bare URLs as links. A wrapped URL resolves in full from any of its rows (see
 * `clickedLink`).
 */
export function LinkedText(props: { text: string; fg: RGBA; linkFg: RGBA }) {
  return (
    <text fg={props.fg}>
      <For each={linkify(props.text)}>
        {(part) => (
          <Show when={part.href} fallback={part.text}>
            {(href) => (
              <a href={href()} style={{ fg: props.linkFg, underline: true }}>
                {part.text}
              </a>
            )}
          </Show>
        )}
      </For>
    </text>
  )
}
