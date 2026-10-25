import { For, Show, createSignal, onMount, splitProps, type ComponentProps, type JSX } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { useI18n } from "../../context/i18n"
import { useFilteredList } from "../../hooks"
import { Button } from "@opencode/ui/button"
import "./line-comment.css"

export interface LineCommentProps extends Omit<ComponentProps<"div">, "onClick" | "onKeyDown"> {
  /** Main comment body (text or rich content). */
  comment: JSX.Element
  /** Optional context under the comment, e.g. the page or element it is about. */
  selection?: JSX.Element
  /** Makes the whole card a button, e.g. to edit the comment. */
  onOpen?: VoidFunction
}

export function LineComment(props: LineCommentProps) {
  const [local, rest] = splitProps(props, ["comment", "selection", "onOpen", "class", "classList"])

  return (
    <div
      {...rest}
      data-component="line-comment-v2"
      data-variant="display"
      role={local.onOpen ? "button" : undefined}
      tabIndex={local.onOpen ? 0 : undefined}
      onClick={() => local.onOpen?.()}
      onKeyDown={(event) => {
        if (!local.onOpen || event.target !== event.currentTarget) return

        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        local.onOpen()
      }}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <div data-slot="line-comment-v2-shell">
        <div data-slot="line-comment-v2-text">{local.comment}</div>
        <Show when={local.selection}>{(selection) => <div data-slot="line-comment-v2-meta">{selection()}</div>}</Show>
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
  /** Optional context in the footer, e.g. the page or element being commented on. */
  selection?: JSX.Element
  placeholder?: string
  rows?: number
  cancelLabel?: string
  submitLabel?: string
  /** Shows a delete action in the footer, e.g. while editing a saved comment. */
  deleteAction?: { label: string; onClick: VoidFunction }
  autofocus?: boolean
  mention?: LineCommentEditorMention
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

  const [local, rest] = splitProps(props, [
    "label",
    "value",
    "onInput",
    "onCancel",
    "onSubmit",
    "selection",
    "placeholder",
    "rows",
    "cancelLabel",
    "submitLabel",
    "deleteAction",
    "autofocus",
    "mention",
    "class",
    "classList",
  ])

  const canSubmit = () => local.value.trim().length > 0

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
          <textarea
            ref={(el) => {
              textareaRef = el
            }}
            data-slot="line-comment-v2-textarea"
            aria-label={local.label ?? i18n.t("ui.lineComment.submit")}
            dir="auto"
            rows={local.rows ?? 4}
            placeholder={local.placeholder ?? i18n.t("ui.lineComment.contextPlaceholder")}
            value={local.value}
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

              if (mentionOpen()) {
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
                const ctrlNav = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "n" || e.key === "p")

                if ((nav || ctrlNav) && mention.flat().length > 0) {
                  mention.onKeyDown(e)
                  e.preventDefault()

                  return
                }
              }

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
          <Show when={mentionOpen() && mention.flat().length > 0}>
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
        <div data-slot="line-comment-v2-footer">
          <Show when={local.selection}>
            {(selection) => <div data-slot="line-comment-v2-footer-meta">{selection()}</div>}
          </Show>
          <Show when={local.deleteAction}>
            {(action) => (
              <Button type="button" size="small" variant="ghost" onClick={() => action().onClick()}>
                {action().label}
              </Button>
            )}
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
      </div>
    </div>
  )
}
