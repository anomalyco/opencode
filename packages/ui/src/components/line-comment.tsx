import { createEffect, createSignal, onMount, Show, splitProps, type JSX } from "solid-js"
import { Button } from "./button"
import { Icon } from "./icon"
import { installLineCommentStyles } from "./line-comment-styles"
import { useI18n } from "../context/i18n"

installLineCommentStyles()

export type LineCommentVariant = "default" | "editor" | "add"

function InlineGlyph(props: { icon: "comment" | "plus" }) {
  return (
    <svg data-slot="line-comment-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <Show
        when={props.icon === "comment"}
        fallback={
          <path
            d="M10 5.41699V10.0003M10 10.0003V14.5837M10 10.0003H5.4165M10 10.0003H14.5832"
            stroke="currentColor"
            stroke-linecap="square"
          />
        }
      >
        <path d="M16.25 3.75H3.75V16.25L6.875 14.4643H16.25V3.75Z" stroke="currentColor" stroke-linecap="square" />
      </Show>
    </svg>
  )
}

export type LineCommentAnchorProps = {
  id?: string
  top?: number
  inline?: boolean
  hideButton?: boolean
  open: boolean
  variant?: LineCommentVariant
  icon?: "comment" | "plus"
  buttonLabel?: string
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  onMouseEnter?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  onPopoverFocusOut?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  class?: string
  popoverClass?: string
  children?: JSX.Element
}

export const LineCommentAnchor = (props: LineCommentAnchorProps) => {
  const hidden = () => !props.inline && props.top === undefined
  const variant = () => props.variant ?? "default"
  const icon = () => props.icon ?? "comment"
  const inlineBody = () => props.inline && props.hideButton

  return (
    <div
      data-component="line-comment"
      data-prevent-autofocus=""
      data-variant={variant()}
      data-comment-id={props.id}
      data-open={props.open ? "" : undefined}
      data-inline={props.inline ? "" : undefined}
      classList={{
        [props.class ?? ""]: !!props.class,
      }}
      style={
        props.inline
          ? undefined
          : {
              top: `${props.top ?? 0}px`,
              opacity: hidden() ? 0 : 1,
              "pointer-events": hidden() ? "none" : "auto",
            }
      }
    >
      <Show
        when={inlineBody()}
        fallback={
          <>
            <button
              type="button"
              aria-label={props.buttonLabel}
              data-slot="line-comment-button"
              on:mousedown={(e) => e.stopPropagation()}
              on:mouseup={(e) => e.stopPropagation()}
              on:click={props.onClick as any}
              on:mouseenter={props.onMouseEnter as any}
            >
              <Show
                when={props.inline}
                fallback={<Icon name={icon() === "plus" ? "plus-small" : "comment"} size="small" />}
              >
                <InlineGlyph icon={icon()} />
              </Show>
            </button>
            <Show when={props.open}>
              <div
                data-slot="line-comment-popover"
                classList={{
                  [props.popoverClass ?? ""]: !!props.popoverClass,
                }}
                on:mousedown={(e) => e.stopPropagation()}
                on:focusout={props.onPopoverFocusOut as any}
              >
                {props.children}
              </div>
            </Show>
          </>
        }
      >
        <div
          data-slot="line-comment-popover"
          data-inline-body=""
          classList={{
            [props.popoverClass ?? ""]: !!props.popoverClass,
          }}
          on:mousedown={(e) => e.stopPropagation()}
          on:click={props.onClick as any}
          on:mouseenter={props.onMouseEnter as any}
          on:focusout={props.onPopoverFocusOut as any}
        >
          {props.children}
        </div>
      </Show>
    </div>
  )
}

export type LineCommentProps = Omit<LineCommentAnchorProps, "children" | "variant"> & {
  comment: JSX.Element
  selection: JSX.Element
  actions?: JSX.Element
}

export const LineComment = (props: LineCommentProps) => {
  const i18n = useI18n()
  const [split, rest] = splitProps(props, ["comment", "selection", "actions"])

  return (
    <LineCommentAnchor {...rest} variant="default" hideButton={props.inline}>
      <div data-slot="line-comment-content">
        <div data-slot="line-comment-head">
          <div data-slot="line-comment-text">{split.comment}</div>
          <Show when={split.actions}>
            <div data-slot="line-comment-tools">{split.actions}</div>
          </Show>
        </div>
        <div data-slot="line-comment-label">
          {i18n.t("ui.lineComment.label.prefix")}
          {split.selection}
          {i18n.t("ui.lineComment.label.suffix")}
        </div>
      </div>
    </LineCommentAnchor>
  )
}

export type LineCommentAddProps = Omit<LineCommentAnchorProps, "children" | "variant" | "open" | "icon"> & {
  label?: string
}

export const LineCommentAdd = (props: LineCommentAddProps) => {
  const [split, rest] = splitProps(props, ["label"])
  const i18n = useI18n()

  return (
    <LineCommentAnchor
      {...rest}
      open={false}
      variant="add"
      icon="plus"
      buttonLabel={split.label ?? i18n.t("ui.lineComment.submit")}
    />
  )
}

export type LineCommentEditorProps = Omit<LineCommentAnchorProps, "children" | "open" | "variant" | "onClick"> & {
  value: string
  selection: JSX.Element
  onInput: (value: string) => void
  onCancel: VoidFunction
  onSubmit: (value: string) => void
  placeholder?: string
  rows?: number
  autofocus?: boolean
  cancelLabel?: string
  submitLabel?: string
}

export const LineCommentEditor = (props: LineCommentEditorProps) => {
  const i18n = useI18n()
  const [split, rest] = splitProps(props, [
    "value",
    "selection",
    "onInput",
    "onCancel",
    "onSubmit",
    "placeholder",
    "rows",
    "autofocus",
    "cancelLabel",
    "submitLabel",
  ])

  const refs = {
    textarea: undefined as HTMLTextAreaElement | undefined,
  }
  const [text, setText] = createSignal(split.value)

  const focus = () => refs.textarea?.focus()

  createEffect(() => {
    setText(split.value)
  })

  const submit = () => {
    const value = text().trim()
    if (!value) return
    split.onSubmit(value)
  }

  onMount(() => {
    if (split.autofocus === false) return
    requestAnimationFrame(focus)
  })

  return (
    <LineCommentAnchor {...rest} open={true} variant="editor" hideButton={props.inline} onClick={() => focus()}>
      <div data-slot="line-comment-editor">
        <textarea
          ref={(el) => {
            refs.textarea = el
          }}
          data-slot="line-comment-textarea"
          rows={split.rows ?? 3}
          placeholder={split.placeholder ?? i18n.t("ui.lineComment.placeholder")}
          value={text()}
          on:input={(e) => {
            const value = (e.currentTarget as HTMLTextAreaElement).value
            setText(value)
            split.onInput(value)
          }}
          on:keydown={(e) => {
            const event = e as KeyboardEvent
            event.stopPropagation()
            if (e.key === "Escape") {
              event.preventDefault()
              split.onCancel()
              return
            }
            if (e.key !== "Enter") return
            if (e.shiftKey) return
            event.preventDefault()
            submit()
          }}
        />
        <div data-slot="line-comment-actions">
          <div data-slot="line-comment-editor-label">
            {i18n.t("ui.lineComment.editorLabel.prefix")}
            {split.selection}
            {i18n.t("ui.lineComment.editorLabel.suffix")}
          </div>
          <Show
            when={!props.inline}
            fallback={
              <>
                <button
                  type="button"
                  data-slot="line-comment-action"
                  data-variant="ghost"
                  on:click={split.onCancel as any}
                >
                  {split.cancelLabel ?? i18n.t("ui.common.cancel")}
                </button>
                <button
                  type="button"
                  data-slot="line-comment-action"
                  data-variant="primary"
                  disabled={text().trim().length === 0}
                  on:click={submit as any}
                >
                  {split.submitLabel ?? i18n.t("ui.lineComment.submit")}
                </button>
              </>
            }
          >
            <Button size="small" variant="ghost" onClick={split.onCancel}>
              {split.cancelLabel ?? i18n.t("ui.common.cancel")}
            </Button>
            <Button size="small" variant="primary" disabled={text().trim().length === 0} onClick={submit}>
              {split.submitLabel ?? i18n.t("ui.lineComment.submit")}
            </Button>
          </Show>
        </div>
      </div>
    </LineCommentAnchor>
  )
}
