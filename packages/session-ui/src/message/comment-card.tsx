import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { getFilenameTruncated } from "@opencode/util/path"
import { Tooltip } from "@opencode/ui/tooltip"
import { AttachmentCard } from "./attachment-card"

/**
 * What a comment is about: lines of a file, a labelled subject such as an element picked in a page, or quoted text.
 * A quote from outside the timeline names its source, such as a terminal.
 */
export type CommentCardTarget =
  | { type: "file"; path: string; selection?: { startLine: number; endLine: number } }
  | { type: "note"; label: string; icon: string; title?: string; subtitle?: string }
  | { type: "quote"; text: string; source?: { label: string; icon: string } }

export function commentCardTarget(
  comment:
    | { type?: "file"; path: string; selection?: { startLine: number; endLine: number } }
    | { type: "note"; label: string; icon: string; title?: string; subtitle?: string }
    | { type: "quote"; text: string; source?: { label: string; icon: string } },
): CommentCardTarget {
  if (comment.type === "note")
    return { type: "note", label: comment.label, icon: comment.icon, title: comment.title, subtitle: comment.subtitle }

  if (comment.type === "quote") return { type: "quote", text: comment.text, source: comment.source }

  return { type: "file", path: comment.path, selection: comment.selection }
}

const QUOTE_PREVIEW_LENGTH = 200

const QUOTE_TOOLTIP_LENGTH = 600

export function quoteTooltip(quote: { text: string; comment?: string }) {
  const text = quote.text.length > QUOTE_TOOLTIP_LENGTH ? `${quote.text.slice(0, QUOTE_TOOLTIP_LENGTH)}…` : quote.text

  return quote.comment ? `${quote.comment}\n\n${text}` : text
}

export function CommentCard(props: {
  comment: string
  target: CommentCardTarget
  active?: boolean
  title?: string
  tooltip?: boolean
  wide?: boolean
  onClick?: () => void
}) {
  const i18n = useI18n()
  let title: HTMLSpanElement | undefined
  const [truncated, setTruncated] = createSignal(false)
  const quote = () => (props.target.type === "quote" ? props.target.text.slice(0, QUOTE_PREVIEW_LENGTH) : undefined)
  const source = () => (props.target.type === "quote" ? props.target.source : undefined)
  const note = () => (props.target.type === "note" ? props.target : undefined)

  const subtitle = () => note()?.subtitle?.trim() || note()?.label

  const heading = () => {
    const target = note()

    if (target) return props.comment.trim() ? props.comment : target.title?.trim() || target.label

    return props.comment || (quote() ?? "")
  }

  const tooltipDisabled = () =>
    !props.tooltip ||
    (!truncated() && !(note() && !props.comment.trim()) && !(props.target.type === "quote" && props.comment))

  onMount(() => {
    const element = title

    if (!element) return
    const sync = () => setTruncated(element.scrollWidth > element.clientWidth)
    const measure = () => requestAnimationFrame(sync)
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    measure()
    void document.fonts?.ready.then(measure)
    onCleanup(() => observer.disconnect())
  })

  return (
    <Tooltip
      placement="top"
      openDelay={1000}
      value={props.title ?? (note() && !props.comment.trim() ? `${heading()}\n${subtitle()}` : heading())}
      disabled={tooltipDisabled()}
      class={props.wide ? "w-full" : undefined}
      contentStyle={{ "max-width": "320px", "white-space": "pre-wrap" }}
    >
      <AttachmentCard
        title={heading()}
        active={props.active}
        clickable={!!props.onClick}
        wide={props.wide}
        surface="base"
        titleRef={(element) => {
          title = element
        }}
        onClick={props.onClick}
      >
        <Switch>
          <Match when={props.target.type === "file" ? props.target : undefined}>
            {(file) => (
              <>
                <FileIcon node={{ path: file().path, type: "file" }} />
                <span>
                  {getFilenameTruncated(file().path, 14)}
                  <Show when={file().selection}>
                    {(sel) =>
                      sel().startLine === sel().endLine ? `:${sel().startLine}` : `:${sel().startLine}-${sel().endLine}`
                    }
                  </Show>
                </span>
              </>
            )}
          </Match>
          <Match when={props.target.type === "note" ? props.target : undefined}>
            {(note) => (
              <>
                <Icon name={note().icon} data-slot="attachment-card-icon" />
                <span data-slot="attachment-card-label" dir="ltr">
                  {subtitle()}
                </span>
              </>
            )}
          </Match>
          <Match when={quote()}>
            {(text) => (
              <>
                <span data-slot="comment-card-quote">
                  <Icon name={source()?.icon ?? "outline-quote"} data-slot="attachment-card-icon" />
                  <span data-slot="attachment-card-label" dir="auto">
                    {props.comment ? text() : (source()?.label ?? i18n.t("ui.commentCard.quote"))}
                  </span>
                </span>
                <Show when={props.onClick}>
                  <span data-slot="comment-card-action" data-commented={props.comment ? "" : undefined}>
                    <Icon name="comment" data-slot="attachment-card-icon" />
                    <span data-slot="attachment-card-label">
                      {props.comment ? i18n.t("ui.commentCard.editComment") : i18n.t("ui.commentCard.addComment")}
                    </span>
                  </span>
                </Show>
              </>
            )}
          </Match>
        </Switch>
      </AttachmentCard>
    </Tooltip>
  )
}
