import { type ComponentProps, type JSX, Show, onMount, splitProps } from "solid-js"
import { ButtonV2 } from "./button-v2"
import "./line-comment-v2.css"

/** Horizontal “more” glyph for the display-card overflow control (Figma outline-dots). */
export function LineCommentV2OverflowIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      width={props.width ?? 16}
      height={props.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={props["aria-hidden"] ?? "true"}
    >
      <path d="M2.5 7.5H3.5V8.5H2.5V7.5Z" stroke="currentColor" />
      <path d="M7.5 7.5H8.5V8.5H7.5V7.5Z" stroke="currentColor" />
      <path d="M12.5 7.5H13.5V8.5H12.5V7.5Z" stroke="currentColor" />
    </svg>
  )
}

export interface LineCommentV2Props extends ComponentProps<"div"> {
  /** Main comment body (text or rich content). */
  comment: JSX.Element
  /** Line / selection context (e.g. “Comment on line 40”). */
  selection: JSX.Element
  /** Typically an overflow menu trigger; use `LineCommentV2OverflowIcon` inside `line-comment-v2-overflow`. */
  actions?: JSX.Element
}

export function LineCommentV2(props: LineCommentV2Props) {
  const [local, rest] = splitProps(props, ["comment", "selection", "actions", "class", "classList"])
  return (
    <div
      {...rest}
      data-component="line-comment-v2"
      data-variant="display"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <div data-slot="line-comment-v2-shell">
        <div data-slot="line-comment-v2-column">
          <div data-slot="line-comment-v2-text">{local.comment}</div>
          <div data-slot="line-comment-v2-meta">{local.selection}</div>
        </div>
        <Show when={local.actions}>
          {(actions) => <div data-slot="line-comment-v2-tools">{actions()}</div>}
        </Show>
      </div>
    </div>
  )
}

export interface LineCommentEditorV2Props
  extends Omit<ComponentProps<"div">, "children" | "onInput" | "onSubmit"> {
  /** Visible field label above the textarea (default: “Comment”). */
  heading?: JSX.Element | string
  value: string
  onInput: (value: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  selection: JSX.Element
  placeholder?: string
  rows?: number
  cancelLabel?: string
  submitLabel?: string
  autofocus?: boolean
}

export function LineCommentEditorV2(props: LineCommentEditorV2Props) {
  let textareaRef: HTMLTextAreaElement | undefined

  const [local, rest] = splitProps(props, [
    "heading",
    "value",
    "onInput",
    "onCancel",
    "onSubmit",
    "selection",
    "placeholder",
    "rows",
    "cancelLabel",
    "submitLabel",
    "autofocus",
    "class",
    "classList",
  ])

  const heading = () => local.heading ?? "Comment"
  const canSubmit = () => local.value.trim().length > 0

  const submit = () => {
    const v = local.value.trim()
    if (!v) return
    local.onSubmit(v)
  }

  onMount(() => {
    if (local.autofocus === false) return
    requestAnimationFrame(() => textareaRef?.focus())
  })

  return (
    <div
      {...rest}
      data-component="line-comment-v2"
      data-variant="editor"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <div data-slot="line-comment-v2-shell">
        <div data-slot="line-comment-v2-field">
          <div data-slot="line-comment-v2-label">{heading()}</div>
          <textarea
            ref={(el) => {
              textareaRef = el
            }}
            data-slot="line-comment-v2-textarea"
            rows={local.rows ?? 3}
            placeholder={local.placeholder ?? "Add context for this change"}
            value={local.value}
            onInput={(e) => local.onInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Escape") {
                e.preventDefault()
                e.currentTarget.blur()
                local.onCancel()
                return
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>
        <div data-slot="line-comment-v2-footer">
          <div data-slot="line-comment-v2-footer-meta">{local.selection}</div>
          <div data-slot="line-comment-v2-footer-actions">
            <ButtonV2 type="button" size="normal" variant="neutral" onClick={() => local.onCancel()}>
              {local.cancelLabel ?? "Cancel"}
            </ButtonV2>
            <ButtonV2
              type="button"
              size="normal"
              variant="contrast"
              disabled={!canSubmit()}
              onClick={submit}
            >
              {local.submitLabel ?? "Comment"}
            </ButtonV2>
          </div>
        </div>
      </div>
    </div>
  )
}
