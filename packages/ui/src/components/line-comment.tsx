import { Show, type JSX } from "solid-js"
import { Icon } from "./icon"

export type LineCommentVariant = "default" | "editor"

export type LineCommentAnchorProps = {
  id?: string
  top?: number
  open: boolean
  variant?: LineCommentVariant
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  onMouseEnter?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  onPopoverFocusOut?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  class?: string
  popoverClass?: string
  children: JSX.Element
}

export const LineCommentAnchor = (props: LineCommentAnchorProps) => {
  const hidden = () => props.top === undefined
  const variant = () => props.variant ?? "default"

  return (
    <div
      data-component="line-comment"
      data-variant={variant()}
      data-comment-id={props.id}
      data-open={props.open ? "" : undefined}
      classList={{
        [props.class ?? ""]: !!props.class,
      }}
      style={{
        top: `${props.top ?? 0}px`,
        opacity: hidden() ? 0 : 1,
        "pointer-events": hidden() ? "none" : "auto",
      }}
    >
      <button type="button" data-slot="line-comment-button" onClick={props.onClick} onMouseEnter={props.onMouseEnter}>
        <Icon name="comment" size="small" />
      </button>
      <Show when={props.open}>
        <div
          data-slot="line-comment-popover"
          classList={{
            [props.popoverClass ?? ""]: !!props.popoverClass,
          }}
          onFocusOut={props.onPopoverFocusOut}
        >
          {props.children}
        </div>
      </Show>
    </div>
  )
}
