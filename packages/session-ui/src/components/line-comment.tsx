import { getDirectory, getFilename } from "@opencode/util/path"
import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
  untrack,
  type JSX,
} from "solid-js"
import {
  createLineCommentEditorState,
  MENTION_TIMEOUT_MS,
  parseMentionToken,
  transitionLineCommentEditor,
  viewLineCommentEditor,
  type LineCommentEditorConfig,
  type LineCommentEditorEffect,
  type LineCommentEditorEvent,
} from "@opencode/ui/line-comment/machine"
import { Button } from "@opencode/ui/button"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { installLineCommentStyles } from "./line-comment-styles"
import { useI18n } from "@opencode/ui/context/i18n"

installLineCommentStyles()

export type LineCommentVariant = "default" | "editor"

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
  onClick?: (event: MouseEvent) => void
  onMouseEnter?: (event: MouseEvent) => void
  onPopoverFocusOut?: (event: FocusEvent) => void
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
              onMouseDown={(event) => event.stopPropagation()}
              onMouseUp={(event) => event.stopPropagation()}
              onClick={props.onClick}
              onMouseEnter={props.onMouseEnter}
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
                onMouseDown={(event) => event.stopPropagation()}
                onFocusOut={props.onPopoverFocusOut}
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
          onMouseDown={(event) => event.stopPropagation()}
          onClick={props.onClick}
          onMouseEnter={props.onMouseEnter}
          onFocusOut={props.onPopoverFocusOut}
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
  mention?: {
    items: (query: string) => string[] | Promise<string[]>
  }
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
    "mention",
  ])

  const refs = {
    textarea: undefined as HTMLTextAreaElement | undefined,
  }

  let mentionTimer: ReturnType<typeof setTimeout> | undefined
  let focusFrame: number | undefined
  const [editorState, setEditorState] = createSignal(createLineCommentEditorState())

  const readConfig = (): LineCommentEditorConfig => ({
    value: split.value,
    allowEmpty: false,
    variant: "default",
    alternateSubmit: null,
    submitting: false,
  })

  const view = createMemo(() => viewLineCommentEditor(editorState(), readConfig()))

  const currentToken = () =>
    split.mention && refs.textarea
      ? parseMentionToken(refs.textarea.value, refs.textarea.selectionStart, refs.textarea.selectionEnd)
      : null

  const dispatch = (event: LineCommentEditorEvent) => {
    const transition = transitionLineCommentEditor(untrack(editorState), event)
    setEditorState(transition.state)

    if (transition.state.status !== "mention-loading") clearTimeout(mentionTimer)
    transition.effects.forEach(run)

    return transition.handled
  }

  const run = (effect: LineCommentEditorEffect) => {
    if (effect.type === "mention.load") {
      const attempt = effect.attempt
      clearTimeout(mentionTimer)
      mentionTimer = setTimeout(() => dispatch({ type: "mention.timeout", attempt }), MENTION_TIMEOUT_MS)
      // A search that returns, rejects or throws settles its attempt.
      void Promise.resolve()
        .then(() => untrack(() => split.mention?.items(effect.query) ?? []))
        .then(
          (items) => dispatch({ type: "mention.loaded", attempt, items }),
          () => dispatch({ type: "mention.failed", attempt }),
        )

      return
    }

    if (effect.type === "mention.insert") {
      const textarea = refs.textarea

      if (!textarea) return
      const value = `${textarea.value.slice(0, effect.token.start)}@${effect.path} ${textarea.value.slice(effect.token.end)}`
      split.onInput(value)
      scheduleFocus(effect.token.start + effect.path.length + 2)

      return
    }

    if (effect.type === "submit") return split.onSubmit(effect.value)

    if (effect.blur) refs.textarea?.blur()
    split.onCancel()
  }

  const scheduleFocus = (cursor?: number) => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined

      if (untrack(editorState).status === "disposed") return
      refs.textarea?.focus()

      if (cursor !== undefined) refs.textarea?.setSelectionRange(cursor, cursor)
    })
  }

  const syncMention = () => dispatch({ type: "mention.synced", token: currentToken() })

  const focus = () => refs.textarea?.focus()

  const hold: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const click =
    (fn: VoidFunction): JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> =>
    (e) => {
      e.stopPropagation()
      fn()
    }

  const cancel = () => dispatch({ type: "cancel.requested" })
  const submit = () => dispatch({ type: "submit.requested", config: readConfig() })

  createComputed(
    on(
      () => !!split.mention,
      () => dispatch({ type: "props.synced", config: readConfig(), token: currentToken() }),
    ),
  )

  // An owner that resets or rewrites the value closes a mention list the new text no longer has.
  createEffect(
    on(
      () => split.value,
      () => dispatch({ type: "props.synced", config: readConfig(), token: currentToken() }),
      { defer: true },
    ),
  )

  onMount(() => {
    if (split.autofocus === false) return
    scheduleFocus()
  })

  onCleanup(() => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    clearTimeout(mentionTimer)
    dispatch({ type: "disposed" })
  })

  return (
    <LineCommentAnchor {...rest} open={true} variant="editor" hideButton={props.inline} onClick={() => focus()}>
      <div data-slot="line-comment-editor">
        <textarea
          ref={(el) => {
            refs.textarea = el
          }}
          data-slot="line-comment-textarea"
          // Escape here closes the mention list or cancels the comment, not a dialog or popover around the editor.
          data-owns-escape
          dir="auto"
          rows={split.rows ?? 3}
          placeholder={split.placeholder ?? i18n.t("ui.lineComment.placeholder")}
          value={split.value}
          style={{ "unicode-bidi": "plaintext", "text-align": "start" }}
          on:input={(e) => {
            const value = (e.currentTarget as HTMLTextAreaElement).value
            split.onInput(value)
            syncMention()
          }}
          on:click={() => syncMention()}
          on:select={() => syncMention()}
          on:keydown={(e) => {
            const event = e as KeyboardEvent

            if (event.isComposing || event.keyCode === 229) return
            event.stopPropagation()

            const handled = dispatch({
              type: "key.down",
              target: "textarea",
              key: event.key,
              ctrl: event.ctrlKey,
              meta: event.metaKey,
              alt: event.altKey,
              shift: event.shiftKey,
              repeat: event.repeat,
              config: readConfig(),
            })

            if (handled) event.preventDefault()
          }}
        />
        <Show when={view().mentionItems.length > 0}>
          <div data-slot="line-comment-mention-list">
            <For each={view().mentionItems}>
              {(path, index) => {
                const directory = path.endsWith("/") ? path : getDirectory(path)
                const name = path.endsWith("/") ? "" : getFilename(path)

                return (
                  <button
                    type="button"
                    data-slot="line-comment-mention-item"
                    data-active={view().activeMentionPath === path ? "" : undefined}
                    on:mousedown={(event) => event.preventDefault()}
                    on:mouseenter={() => dispatch({ type: "mention.hovered", index: index() })}
                    on:click={() => dispatch({ type: "mention.selected", index: index() })}
                  >
                    <FileIcon node={{ path, type: "file" }} class="shrink-0 size-4" />
                    <div data-slot="line-comment-mention-path">
                      <span data-slot="line-comment-mention-dir">{directory}</span>
                      <Show when={name}>
                        <span data-slot="line-comment-mention-file">{name}</span>
                      </Show>
                    </div>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
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
                  onMouseDown={hold}
                  onClick={click(cancel)}
                >
                  {split.cancelLabel ?? i18n.t("ui.common.cancel")}
                </button>
                <button
                  type="button"
                  data-slot="line-comment-action"
                  data-variant="primary"
                  disabled={!view().canSubmit}
                  onMouseDown={hold}
                  onClick={click(submit)}
                >
                  {split.submitLabel ?? i18n.t("ui.lineComment.submit")}
                </button>
              </>
            }
          >
            <Button size="small" variant="ghost" onClick={cancel}>
              {split.cancelLabel ?? i18n.t("ui.common.cancel")}
            </Button>
            <Button size="small" variant="contrast" disabled={!view().canSubmit} onClick={submit}>
              {split.submitLabel ?? i18n.t("ui.lineComment.submit")}
            </Button>
          </Show>
        </div>
      </div>
    </LineCommentAnchor>
  )
}
