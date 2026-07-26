import { For, Show, createSignal, onMount, splitProps, type ComponentProps, type JSX } from "solid-js"
import { FileIcon } from "../../components/file-icon"
import { useFilteredList } from "../../hooks"
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
        <Show when={local.actions}>{(actions) => <div data-slot="line-comment-v2-tools">{actions()}</div>}</Show>
      </div>
    </div>
  )
}

export type LineCommentEditorV2Mention = {
  items: (query: string) => string[] | Promise<string[]>
}

export interface LineCommentEditorV2Props extends Omit<ComponentProps<"div">, "children" | "onInput" | "onSubmit"> {
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
  mention?: LineCommentEditorV2Mention
}

function pathFilename(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return index === -1 ? path : path.slice(index + 1)
}

function pathDirectory(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return index === -1 ? "" : path.slice(0, index + 1)
}

export function LineCommentEditorV2(props: LineCommentEditorV2Props) {
  let textareaRef: HTMLTextAreaElement | undefined
  const [mentionOpen, setMentionOpen] = createSignal(false)

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
    "mention",
    "class",
    "classList",
  ])

  const heading = () => local.heading ?? "Comment"
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
          <div data-slot="line-comment-v2-label">{heading()}</div>
          <textarea
            ref={(el) => {
              textareaRef = el
            }}
            data-slot="line-comment-v2-textarea"
            rows={local.rows ?? 3}
            placeholder={local.placeholder ?? "Add context for this change"}
            value={local.value}
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
          <div data-slot="line-comment-v2-footer-meta">{local.selection}</div>
          <div data-slot="line-comment-v2-footer-actions">
            <ButtonV2 type="button" size="normal" variant="neutral" onClick={() => local.onCancel()}>
              {local.cancelLabel ?? "Cancel"}
            </ButtonV2>
            <ButtonV2 type="button" size="normal" variant="contrast" disabled={!canSubmit()} onClick={submit}>
              {local.submitLabel ?? "Comment"}
            </ButtonV2>
          </div>
        </div>
      </div>
    </div>
  )
}
