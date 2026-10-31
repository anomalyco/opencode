import {
  For,
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  splitProps,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { useI18n } from "../../context/i18n"
import { useFilteredList } from "../../hooks"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { Loader } from "@opencode/ui/loader"
import { makeEventListener } from "@solid-primitives/event-listener"
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
  const [mentionOpen, setMentionOpen] = createSignal(false)

  const [alternate, setAlternate] = createSignal(false)

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

  const canSubmit = () => !!local.allowEmpty || local.value.trim().length > 0
  const compactCancel = () => !canSubmit()

  const alternateActive = () => !!local.alternateSubmit && alternate()

  const compactLabel = () =>
    alternateActive()
      ? local.alternateSubmit!.label
      : compactCancel()
        ? (local.cancelLabel ?? i18n.t("ui.lineComment.cancel"))
        : (local.submitLabel ?? i18n.t("ui.lineComment.submit"))

  createEffect(() => {
    if (local.variant !== "compact" || !local.alternateSubmit) return

    const update = (event: KeyboardEvent) => setAlternate(modified(event))

    // Capture modifier releases; the textarea stops key propagation.
    makeEventListener(document, "keydown", update, { capture: true })
    makeEventListener(document, "keyup", update, { capture: true })
    makeEventListener(window, "blur", () => setAlternate(false))
  })

  const closeMention = () => {
    setMentionOpen(false)
    mention.clear()
  }

  const currentMention = () => {
    const textarea = textareaRef

    if (!textarea) return

    if (!local.mention) return

    if (textarea.selectionStart !== textarea.selectionEnd) return

    const end = textarea.selectionStart
    const match = textarea.value.slice(0, end).match(/@(\S*)$/)

    if (!match) return

    return {
      query: match[1] ?? "",
      start: end - match[0].length,
      end,
    }
  }

  function selectMention(item: { path: string } | undefined) {
    if (!item) return

    const textarea = textareaRef
    const query = currentMention()

    if (!textarea || !query) return

    const value = `${textarea.value.slice(0, query.start)}@${item.path} ${textarea.value.slice(query.end)}`
    const cursor = query.start + item.path.length + 2

    local.onInput(value)
    closeMention()

    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  const mention = useFilteredList<{ path: string }>({
    items: async (query) => {
      if (!local.mention) return []

      if (!query.trim()) return []
      const paths = await local.mention.items(query)

      return paths.map((path) => ({ path }))
    },
    key: (item) => item.path,
    filterKeys: ["path"],
    skipFilter: () => true,
    onSelect: selectMention,
  })

  const syncMention = () => {
    const item = currentMention()

    if (!item) {
      closeMention()

      return
    }

    setMentionOpen(true)
    mention.onInput(item.query)
  }

  const selectActiveMention = () => {
    const items = mention.flat()

    if (items.length === 0) return
    const active = mention.active()
    selectMention(items.find((item) => item.path === active) ?? items[0])
  }

  const submit = (alternate = false) => {
    if (local.submitting) return
    const v = local.value.trim()

    if (!v && !local.allowEmpty) return

    if (alternate && local.alternateSubmit) {
      if (!local.alternateSubmit.disabled) local.alternateSubmit.onSubmit(v)

      return
    }

    local.onSubmit(v)
  }

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
      aria-busy={local.submitting || undefined}
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
              data-scrollable
              aria-label={local.label ?? i18n.t("ui.lineComment.submit")}
              dir="auto"
              rows={local.rows ?? (local.variant === "compact" ? 1 : 4)}
              placeholder={local.placeholder ?? i18n.t("ui.lineComment.contextPlaceholder")}
              value={local.value}
              readOnly={local.submitting}
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

                if (mentionOpen() && !local.submitting) {
                  if (e.key === "Escape") {
                    e.preventDefault()
                    closeMention()

                    return
                  }

                  if (e.key === "Tab") {
                    if (mention.flat().length === 0) return
                    e.preventDefault()
                    selectActiveMention()

                    return
                  }

                  const nav = e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter"

                  const ctrlNav =
                    e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "n" || e.key === "p")

                  if ((nav || ctrlNav) && mention.flat().length > 0) {
                    mention.onKeyDown(e)
                    e.preventDefault()

                    return
                  }
                }

                if (e.key === "Escape") {
                  e.preventDefault()

                  if (local.submitting) return
                  e.currentTarget.blur()
                  local.onCancel()

                  return
                }

                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()

                  if (e.repeat) return
                  submit(modified(e))
                }
              }}
            />
            <Show when={!local.submitting && mentionOpen() && mention.flat().length > 0}>
              <div data-slot="line-comment-v2-mention-list">
                <For each={mention.flat().slice(0, 10)}>
                  {(item) => {
                    const directory = item.path.endsWith("/") ? item.path : pathDirectory(item.path)
                    const name = item.path.endsWith("/") ? "" : pathFilename(item.path)

                    return (
                      <button
                        type="button"
                        data-slot="line-comment-v2-mention-item"
                        data-active={mention.active() === item.path ? "" : undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => mention.setActive(item.path)}
                        onClick={() => selectMention(item)}
                      >
                        <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-4" />
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
                      keys={alternateActive() ? local.alternateSubmit!.keys : [compactCancel() ? "Esc" : "⏎"]}
                      variant="neutral"
                    />
                  </div>
                  <Show when={local.alternateSubmit && !alternateActive()}>
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
                type="button"
                size="small"
                variant={
                  alternateActive() || local.submitting ? "submit" : local.value.trim() ? "neutral" : "ghost-muted"
                }
                disabled={local.submitting || (alternateActive() && local.alternateSubmit?.disabled)}
                icon={
                  local.submitting ? (
                    <Loader />
                  ) : alternateActive() ? (
                    <Icon name="arrow-up" />
                  ) : compactCancel() ? (
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
                onPointerEnter={(event) => {
                  if (modified(event)) setAlternate(true)
                }}
                onClick={(event) => {
                  if (compactCancel() && !alternateActive()) return local.onCancel()
                  submit(alternateActive() || modified(event))
                }}
                onKeyDown={(event) => {
                  if (event.isComposing) return

                  if (event.key === "Enter" && modified(event) && local.alternateSubmit) {
                    event.preventDefault()
                    event.stopPropagation()

                    if (!event.repeat) submit(true)

                    return
                  }

                  if (event.key !== "Escape") return
                  event.preventDefault()
                  event.stopPropagation()

                  if (!local.submitting) local.onCancel()
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
              <Button type="button" size="small" variant="ghost" onClick={() => local.onCancel()}>
                {local.cancelLabel ?? i18n.t("ui.lineComment.cancel")}
              </Button>
              <Button type="button" size="small" variant="contrast" disabled={!canSubmit()} onClick={submit}>
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
