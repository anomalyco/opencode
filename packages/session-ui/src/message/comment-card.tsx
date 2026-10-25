import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { getFilenameTruncated } from "@opencode/util/path"
import { Tooltip } from "@opencode/ui/tooltip"
import { AttachmentCard } from "./attachment-card"

/** What a comment is about: lines of a file, or a labelled subject such as an element picked in a page. */
export type CommentCardTarget =
  | { type: "file"; path: string; selection?: { startLine: number; endLine: number } }
  | { type: "note"; label: string; icon: string }

export function CommentCard(props: {
  comment: string
  target: CommentCardTarget
  active?: boolean
  title?: string
  tooltip?: boolean
  wide?: boolean
  onClick?: () => void
}) {
  let title: HTMLSpanElement | undefined
  const [truncated, setTruncated] = createSignal(false)

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
      value={props.title ?? props.comment}
      disabled={!props.tooltip || !truncated()}
      class={props.wide ? "w-full" : undefined}
      contentStyle={{ "max-width": "320px", "white-space": "pre-wrap" }}
    >
      <AttachmentCard
        title={props.comment}
        active={props.active}
        clickable={!!props.onClick}
        wide={props.wide}
        surface="base"
        titleRef={(element) => {
          title = element
        }}
        onClick={props.onClick}
      >
        <Show
          when={props.target.type === "note" ? props.target : undefined}
          fallback={
            <Show when={props.target.type === "file" ? props.target : undefined}>
              {(file) => (
                <>
                  <FileIcon node={{ path: file().path, type: "file" }} />
                  <span>
                    {getFilenameTruncated(file().path, 14)}
                    <Show when={file().selection}>
                      {(sel) =>
                        sel().startLine === sel().endLine
                          ? `:${sel().startLine}`
                          : `:${sel().startLine}-${sel().endLine}`
                      }
                    </Show>
                  </span>
                </>
              )}
            </Show>
          }
        >
          {(note) => (
            <>
              <Icon name={note().icon} data-slot="attachment-card-icon" />
              <span data-slot="attachment-card-label" dir="ltr">
                {note().label}
              </span>
            </>
          )}
        </Show>
      </AttachmentCard>
    </Tooltip>
  )
}
