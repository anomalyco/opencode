import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { getFilenameTruncated } from "@opencode/util/path"
import type { SessionUserComment } from "../actions"
import { commentSegments, selectionLabel } from "./user-message-quote-parts"

type Quote = Extract<SessionUserComment, { type: "quote" }>

type Reference = Exclude<SessionUserComment, Quote>

// Quote text and comments set no `dir`: the bubble's `dir="auto"` skips elements that set their own, so a bubble of
// only quotes would miss their language. `unicode-bidi: plaintext` gives each paragraph its direction instead.
export function UserMessageQuotes(props: { comments: SessionUserComment[] }) {
  return (
    <div data-slot="user-message-quotes">
      <For each={props.comments}>
        {(item) =>
          item.type === "quote" ? <UserMessageQuote quote={item} /> : <UserMessageReference reference={item} />
        }
      </For>
    </div>
  )
}

function UserMessageQuote(props: { quote: Quote }) {
  const [open, setOpen] = createSignal(false)
  const [clamped, setClamped] = createSignal(false)
  const [single, setSingle] = createSignal(false)
  // Blank lines around a selection carry nothing, and a quote of only whitespace shows just its comment.
  const text = () => props.quote.text.trim()
  const expandable = () => clamped() || open()

  const toggle = (element: HTMLElement) => {
    // Ending a text selection inside the quote is a click too; it should not open or close it.
    const selection = window.getSelection()

    if (selection && !selection.isCollapsed && element.contains(selection.anchorNode)) return
    setOpen((value) => !value)
  }

  return (
    <div data-slot="user-message-quote-group">
      <Show when={text()}>
        <blockquote data-slot="user-message-quote" data-single-line={single() ? "" : undefined}>
          <div
            data-slot="user-message-quote-text"
            data-open={open() ? "" : undefined}
            data-expandable={expandable() ? "" : undefined}
            role={expandable() ? "button" : undefined}
            tabIndex={expandable() ? 0 : undefined}
            aria-expanded={expandable() ? open() : undefined}
            ref={(element) =>
              onMount(() => {
                const measure = () => {
                  setClamped(element.scrollHeight > element.clientHeight + 1)
                  setSingle(element.clientHeight <= parseFloat(getComputedStyle(element).lineHeight) + 1)
                }

                const observer = new ResizeObserver(measure)

                observer.observe(element)
                void document.fonts.ready.then(measure)
                onCleanup(() => observer.disconnect())
              })
            }
            onClick={(event) => expandable() && toggle(event.currentTarget)}
            onKeyDown={(event) => {
              if (!expandable() || (event.key !== "Enter" && event.key !== " ")) return
              event.preventDefault()
              setOpen((value) => !value)
            }}
          >
            <Show when={props.quote.source}>
              {(source) => (
                <span data-slot="user-message-quote-icon" title={source().label} aria-label={source().label} role="img">
                  <Icon name={source().icon} size="small" />
                </span>
              )}
            </Show>
            {text()}
          </div>
        </blockquote>
      </Show>
      <Show when={props.quote.comment?.trim()}>{(comment) => <UserMessageQuoteComment text={comment()} />}</Show>
    </div>
  )
}

function UserMessageReference(props: { reference: Reference }) {
  return (
    <div data-slot="user-message-quote-group">
      <blockquote data-slot="user-message-quote" data-single-line>
        <span data-slot="user-message-quote-reference">
          {props.reference.type === "note" ? (
            <>
              <Icon name={props.reference.icon} size="small" />
              <span data-slot="user-message-quote-reference-label" dir="ltr">
                {props.reference.title?.trim() || props.reference.label}
              </span>
              <Show when={props.reference.subtitle?.trim()}>
                {(subtitle) => (
                  <span data-slot="user-message-quote-reference-detail" dir="auto">
                    {subtitle()}
                  </span>
                )}
              </Show>
            </>
          ) : (
            <>
              <FileIcon
                node={{ path: props.reference.path, type: props.reference.path.endsWith("/") ? "directory" : "file" }}
              />
              <span data-slot="user-message-quote-reference-label" dir="ltr">
                {getFilenameTruncated(props.reference.path, 40)}
                {selectionLabel(props.reference.selection)}
              </span>
            </>
          )}
        </span>
      </blockquote>
      <Show when={props.reference.comment.trim()}>{(comment) => <UserMessageQuoteComment text={comment()} />}</Show>
    </div>
  )
}

function UserMessageQuoteComment(props: { text: string }) {
  return (
    <div data-slot="user-message-quote-comment">
      <For each={commentSegments(props.text)}>
        {(segment) => (segment.mention ? <span data-highlight="file">{segment.text}</span> : segment.text)}
      </For>
    </div>
  )
}
