import {
  For,
  Show,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  splitProps,
  untrack,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { useI18n } from "../../context/i18n"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { Loader } from "@opencode/ui/loader"
import { makeEventListener } from "@solid-primitives/event-listener"
import {
  createLineCommentEditorState,
  MENTION_TIMEOUT_MS,
  parseMentionToken,
  transitionLineCommentEditor,
  viewLineCommentEditor,
  type LineCommentEditorConfig,
  type LineCommentEditorEffect,
  type LineCommentEditorEvent,
} from "./machine"
import check from "./quote-check.svg"
import "./line-comment.css"

/** Horizontal “more” glyph for the display-card overflow control (Figma outline-dots). */
export function LineCommentOverflowIcon(props: ComponentProps<"svg">) {
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

export interface LineCommentProps extends Omit<ComponentProps<"div">, "onClick"> {
  /** Main comment body (text or rich content). */
  comment: JSX.Element
  /** Optional context under the comment, e.g. the page or element it is about. */
  selection?: JSX.Element
  /** Typically an overflow menu trigger; use `LineCommentOverflowIcon` inside `line-comment-v2-overflow`. */
  actions?: JSX.Element
  /** Opens the comment, e.g. its editor, from a click anywhere on the card. Keep a keyboard path in `actions`. */
  onOpen?: VoidFunction
}

export function LineComment(props: LineCommentProps) {
  const [local, rest] = splitProps(props, ["comment", "selection", "actions", "onOpen", "class", "classList"])

  return (
    <div
      {...rest}
      data-component="line-comment-v2"
      data-variant="display"
      data-clickable={local.onOpen ? "" : undefined}
      onClick={() => local.onOpen?.()}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <div data-slot="line-comment-v2-shell">
        <div data-slot="line-comment-v2-column">
          <div data-slot="line-comment-v2-text">{local.comment}</div>
          <Show when={local.selection}>{(selection) => <div data-slot="line-comment-v2-meta">{selection()}</div>}</Show>
        </div>
        <Show when={local.actions}>{(actions) => <div data-slot="line-comment-v2-tools">{actions()}</div>}</Show>
      </div>
    </div>
  )
}

export type LineCommentEditorMention = {
  items: (query: string) => string[] | Promise<string[]>
}

export interface LineCommentEditorProps extends Omit<ComponentProps<"div">, "children" | "onInput" | "onSubmit"> {
  /** Accessible name of the text field (default: “Comment”). */
  label?: string
  value: string
  onInput: (value: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  /** Optional context in the footer, or above the input in the compact variant. */
  selection?: JSX.Element
  /** Compact layout with a growing input and inline action. */
  variant?: "default" | "compact"
  placeholder?: string
  rows?: number
  cancelLabel?: string
  submitLabel?: string
  autofocus?: boolean
  /** Submit an empty value too, such as to clear a comment that exists (default: false). Compact empty actions otherwise cancel. */
  allowEmpty?: boolean
  mention?: LineCommentEditorMention
  /** Compact editor action on Mod+Enter or modifier-click. */
  alternateSubmit?: {
    label: string
    keys: string[]
    disabled?: boolean
    onSubmit: (value: string) => void
  }
  /** Keep the draft read-only and prevent duplicate actions while its submission settles. */
  submitting?: boolean
}

function pathFilename(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))

  return index === -1 ? path : path.slice(index + 1)
}

function pathDirectory(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))

  return index === -1 ? "" : path.slice(0, index + 1)
}

export function LineCommentEditor(props: LineCommentEditorProps) {
  const i18n = useI18n()
  let textareaRef: HTMLTextAreaElement | undefined
  let mentionTimer: ReturnType<typeof setTimeout> | undefined
  const [editorState, setEditorState] = createSignal(createLineCommentEditorState())

  const [local, rest] = splitProps(props, [
    "label",
    "value",
    "onInput",
    "onCancel",
    "onSubmit",
    "selection",
    "variant",
    "placeholder",
    "rows",
    "cancelLabel",
    "submitLabel",
    "autofocus",
    "allowEmpty",
    "mention",
    "alternateSubmit",
    "submitting",
    "class",
    "classList",
  ])

  const readConfig = (): LineCommentEditorConfig => ({
    value: local.value,
    allowEmpty: !!local.allowEmpty,
    variant: local.variant ?? "default",
    alternateSubmit: local.alternateSubmit ? { disabled: !!local.alternateSubmit.disabled } : null,
    submitting: !!local.submitting,
  })

  const view = createMemo(() => viewLineCommentEditor(editorState(), readConfig()))

  const compactLabel = () =>
    view().alternateActive
      ? local.alternateSubmit!.label
      : view().compactCancel
        ? (local.cancelLabel ?? i18n.t("ui.lineComment.cancel"))
        : (local.submitLabel ?? i18n.t("ui.lineComment.submit"))

  const currentToken = () =>
    local.mention && textareaRef
      ? parseMentionToken(textareaRef.value, textareaRef.selectionStart, textareaRef.selectionEnd)
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
      const result = untrack(() => local.mention?.items(effect.query) ?? [])

      if (Array.isArray(result)) return dispatch({ type: "mention.loaded", attempt, items: result })
      void result.then(
        (items) => dispatch({ type: "mention.loaded", attempt, items }),
        () => dispatch({ type: "mention.failed", attempt }),
      )

      return
    }

    if (effect.type === "mention.insert") {
      const textarea = textareaRef

      if (!textarea) return
      const value = `${textarea.value.slice(0, effect.token.start)}@${effect.path} ${textarea.value.slice(effect.token.end)}`
      const cursor = effect.token.start + effect.path.length + 2
      local.onInput(value)
      requestAnimationFrame(() => {
        if (untrack(editorState).status === "disposed") return
        textarea.focus()
        textarea.setSelectionRange(cursor, cursor)
      })

      return
    }

    if (effect.type === "submit") {
      if (effect.mode === "alternate") return local.alternateSubmit?.onSubmit(effect.value)

      return local.onSubmit(effect.value)
    }

    if (effect.blur) textareaRef?.blur()
    local.onCancel()
  }

  const keyEvent = (event: KeyboardEvent, target: "textarea" | "action") =>
    dispatch({
      type: "key.down",
      target,
      key: event.key,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
      repeat: event.repeat,
      config: readConfig(),
    })

  createComputed(
    on(
      [
        () => local.submitting,
        () => local.variant,
        () => local.allowEmpty,
        () => !!local.mention,
        () => local.alternateSubmit?.disabled,
        () => !!local.alternateSubmit,
      ],
      () => dispatch({ type: "props.synced", config: readConfig(), token: currentToken() }),
    ),
  )

  // An owner that resets or rewrites the value closes a mention list the new text no longer has.
  createEffect(
    on(
      () => local.value,
      () => dispatch({ type: "props.synced", config: readConfig(), token: currentToken() }),
      { defer: true },
    ),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  const trackModifiers = createMemo(() => view().trackModifiers)

  createEffect(() => {
    if (!trackModifiers()) return

    const update = (event: KeyboardEvent) =>
      dispatch({ type: "modifier.changed", active: modified(event), config: readConfig() })

    // Capture modifier releases; the textarea stops key propagation.
    makeEventListener(document, "keydown", update, { capture: true })
    makeEventListener(document, "keyup", update, { capture: true })
    makeEventListener(window, "blur", () => dispatch({ type: "window.blurred" }))
  })

  const syncMention = () => dispatch({ type: "mention.synced", token: currentToken() })

  onMount(() => {
    if (local.autofocus === false) return
    requestAnimationFrame(() => textareaRef?.focus())
  })

  onMount(() => {
    if (CSS.supports("field-sizing", "content")) return

    createEffect(() => {
      const textarea = textareaRef

      if (local.variant !== "compact" || !textarea) return

      const resize = () => {
        // Reset before measuring so the field can shrink as well as grow.
        textarea.style.height = "0px"
        textarea.style.height = `${textarea.scrollHeight}px`
      }

      createEffect(on(() => local.value, resize))

      let width = 0

      const observer = new ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width === width) return
        width = entry.contentRect.width
        resize()
      })

      observer.observe(textarea)
      onCleanup(() => {
        observer.disconnect()
        textarea.style.removeProperty("height")
      })
    })
  })

  return (
    <div
      {...rest}
      data-component="line-comment-v2"
      data-variant="editor"
      data-layout={local.variant ?? "default"}
      aria-busy={view().submitting || undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <div data-slot="line-comment-v2-shell">
        <Show when={local.variant === "compact" && local.selection}>
          {(selection) => <div data-slot="line-comment-v2-preview">{selection()}</div>}
        </Show>
        <div data-slot="line-comment-v2-input">
          <div data-slot="line-comment-v2-field">
            <textarea
              ref={(el) => {
                textareaRef = el
              }}
              data-slot="line-comment-v2-textarea"
              // Escape here closes the mention list or cancels the comment, not a dialog or popover around the editor.
              data-owns-escape
              data-scrollable
              aria-label={local.label ?? i18n.t("ui.lineComment.submit")}
              dir="auto"
              rows={local.rows ?? (local.variant === "compact" ? 1 : 4)}
              placeholder={local.placeholder ?? i18n.t("ui.lineComment.contextPlaceholder")}
              value={local.value}
              readOnly={view().submitting}
              style={{ "unicode-bidi": "plaintext", "text-align": "start" }}
              onInput={(e) => {
                local.onInput(e.currentTarget.value)
                syncMention()
              }}
              onClick={() => syncMention()}
              onSelect={() => syncMention()}
              onKeyDown={(e) => {
                e.stopPropagation()

                if (e.isComposing || e.keyCode === 229) return

                if (keyEvent(e, "textarea")) e.preventDefault()
              }}
            />
            <Show when={view().mentionItems.length > 0}>
              <div data-slot="line-comment-v2-mention-list">
                <For each={view().mentionItems}>
                  {(path, index) => {
                    const directory = path.endsWith("/") ? path : pathDirectory(path)
                    const name = path.endsWith("/") ? "" : pathFilename(path)

                    return (
                      <button
                        type="button"
                        data-slot="line-comment-v2-mention-item"
                        data-active={view().activeMentionPath === path ? "" : undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => dispatch({ type: "mention.hovered", index: index() })}
                        onClick={() => dispatch({ type: "mention.selected", index: index() })}
                      >
                        <FileIcon node={{ path, type: "file" }} class="shrink-0 size-4" />
                        <div data-slot="line-comment-v2-mention-path">
                          <span data-slot="line-comment-v2-mention-dir">{directory}</span>
                          <Show when={name}>
                            <span data-slot="line-comment-v2-mention-file">{name}</span>
                          </Show>
                        </div>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
          <Show when={local.variant === "compact"}>
            <Tooltip
              value={
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center gap-1.5">
                    {compactLabel()}
                    <Keybind
                      keys={view().alternateActive ? local.alternateSubmit!.keys : [view().compactCancel ? "Esc" : "⏎"]}
                      variant="neutral"
                    />
                  </div>
                  <Show when={local.alternateSubmit && !view().alternateActive}>
                    <div class="flex items-center gap-1.5">
                      {local.alternateSubmit!.label}
                      <Keybind keys={local.alternateSubmit!.keys} variant="neutral" />
                    </div>
                  </Show>
                </div>
              }
              placement="top"
            >
              <IconButton
                data-slot="line-comment-v2-submit"
                data-owns-escape
                type="button"
                size="small"
                variant={view().compactVariant}
                disabled={view().compactDisabled}
                icon={
                  view().submitting ? (
                    <Loader />
                  ) : view().alternateActive ? (
                    <Icon name="arrow-up" />
                  ) : view().compactCancel ? (
                    <Icon name="close" />
                  ) : (
                    <span
                      aria-hidden="true"
                      data-slot="line-comment-v2-submit-icon"
                      style={{ mask: `url("${check}") center / contain no-repeat` }}
                    />
                  )
                }
                aria-label={compactLabel()}
                onPointerEnter={(event) =>
                  dispatch({ type: "modifier.changed", active: modified(event), config: readConfig() })
                }
                onPointerDown={(event) =>
                  dispatch({ type: "modifier.changed", active: modified(event), config: readConfig() })
                }
                onClick={(event) =>
                  dispatch({ type: "action.clicked", modified: modified(event), config: readConfig() })
                }
                onKeyDown={(event) => {
                  if (event.isComposing) return

                  if (!keyEvent(event, "action")) return
                  event.preventDefault()
                  event.stopPropagation()
                }}
              />
            </Tooltip>
          </Show>
        </div>
        <Show when={local.variant !== "compact"}>
          <div data-slot="line-comment-v2-footer">
            <Show when={local.selection}>
              {(selection) => <div data-slot="line-comment-v2-footer-meta">{selection()}</div>}
            </Show>
            <div data-slot="line-comment-v2-footer-actions">
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={view().submitting}
                onClick={() => dispatch({ type: "cancel.requested" })}
              >
                {local.cancelLabel ?? i18n.t("ui.lineComment.cancel")}
              </Button>
              <Button
                type="button"
                size="small"
                variant="contrast"
                disabled={!view().canSubmit || view().submitting}
                onClick={() => dispatch({ type: "submit.requested", config: readConfig() })}
              >
                {local.submitLabel ?? i18n.t("ui.lineComment.submit")}
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}

function modified(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
}
