import { createEffect, createMemo, createSignal, For, onMount, Show, splitProps, type JSX } from "solid-js"
import { Button } from "./button"
import { Icon } from "./icon"
import { FileIcon } from "./file-icon"
import { useI18n } from "../context/i18n"
import { useFilteredList } from "../hooks/use-filtered-list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

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

export type LineCommentProps = Omit<LineCommentAnchorProps, "children" | "variant"> & {
  comment: JSX.Element
  selection: JSX.Element
}

export const LineComment = (props: LineCommentProps) => {
  const i18n = useI18n()
  const [split, rest] = splitProps(props, ["comment", "selection"])

  return (
    <LineCommentAnchor {...rest} variant="default">
      <div data-slot="line-comment-content">
        <div data-slot="line-comment-text">{split.comment}</div>
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
  onSubmit: (value: string, taggedFiles?: string[]) => void
  placeholder?: string
  rows?: number
  autofocus?: boolean
  cancelLabel?: string
  submitLabel?: string
  onFileSearch?: (query: string) => Promise<string[]>
  recentFiles?: string[]
}

type FileOption = {
  path: string
  display: string
  recent?: boolean
}

function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  return (node.textContent ?? "").replace(/\u200B/g, "").length
}

function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "").length
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  let length = 0
  for (const child of Array.from(node.childNodes)) {
    length += getTextLength(child)
  }
  return length
}

function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return getTextLength(preCaretRange.cloneContents())
}

function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === "file"
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (remaining === 0) {
        range.setStartBefore(node)
      }
      if (remaining > 0 && isPill) {
        range.setStartAfter(node)
      }
      if (remaining > 0 && isBreak) {
        const next = node.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE) {
          range.setStart(next, 0)
        }
        if (!next || next.nodeType !== Node.TEXT_NODE) {
          range.setStartAfter(node)
        }
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild
  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
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
    "onFileSearch",
    "recentFiles",
  ])

  let editorRef!: HTMLDivElement
  const mirror = { input: false }
  const [showPicker, setShowPicker] = createSignal(false)
  const [hasContent, setHasContent] = createSignal(false)

  const { flat, active, onInput: filterOnInput, onKeyDown: filterOnKeyDown } = useFilteredList<FileOption>({
    items: async (query) => {
      const recent = (split.recentFiles ?? []).map((path) => ({ path, display: path, recent: true }))
      const seen = new Set(recent.map((r) => r.path))
      const results = (await split.onFileSearch?.(query)) ?? []
      const files = results.filter((p) => !seen.has(p)).map((path) => ({ path, display: path }))
      return [...recent, ...files]
    },
    key: (x) => x?.path ?? "",
    filterKeys: ["display"],
    groupBy: (x) => (x.recent ? "recent" : "files"),
    sortGroupsBy: (a, b) => (a.category === "recent" ? -1 : 1),
    onSelect: (option) => {
      if (option) insertFilePill(option.path)
    },
  })

  const focus = () => editorRef?.focus()

  const createPill = (path: string) => {
    const pill = document.createElement("span")
    pill.textContent = "@" + path
    pill.setAttribute("data-type", "file")
    pill.setAttribute("data-path", path)
    pill.setAttribute("contenteditable", "false")
    pill.style.userSelect = "text"
    pill.style.cursor = "default"
    return pill
  }

  const setRangeEdge = (range: Range, edge: "start" | "end", offset: number) => {
    let remaining = offset
    const nodes = Array.from(editorRef.childNodes)

    for (const node of nodes) {
      const length = getNodeLength(node)
      const isText = node.nodeType === Node.TEXT_NODE
      const isPill = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === "file"
      const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

      if (isText && remaining <= length) {
        if (edge === "start") range.setStart(node, remaining)
        if (edge === "end") range.setEnd(node, remaining)
        return
      }

      if ((isPill || isBreak) && remaining <= length) {
        if (edge === "start" && remaining === 0) range.setStartBefore(node)
        if (edge === "start" && remaining > 0) range.setStartAfter(node)
        if (edge === "end" && remaining === 0) range.setEndBefore(node)
        if (edge === "end" && remaining > 0) range.setEndAfter(node)
        return
      }

      remaining -= length
    }
  }

  const insertFilePill = (path: string) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const cursorPosition = getCursorPosition(editorRef)
    const rawText = getRawText()
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    const pill = createPill(path)
    const gap = document.createTextNode(" ")
    const range = selection.getRangeAt(0)

    if (atMatch) {
      const start = atMatch.index ?? cursorPosition - atMatch[0].length
      setRangeEdge(range, "start", start)
      setRangeEdge(range, "end", cursorPosition)
    }

    range.deleteContents()
    range.insertNode(gap)
    range.insertNode(pill)
    range.setStartAfter(gap)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)

    handleInput()
    setShowPicker(false)
  }

  const getRawText = (): string => {
    let text = ""
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      if (el.dataset.type === "file") {
        text += el.textContent ?? ""
        return
      }
      if (el.tagName === "BR") {
        text += "\n"
        return
      }
      for (const child of Array.from(el.childNodes)) {
        visit(child)
      }
    }
    for (const child of Array.from(editorRef.childNodes)) {
      visit(child)
    }
    return text.replace(/\u200B/g, "")
  }

  const parseFromDOM = (): { text: string; files: string[] } => {
    let text = ""
    const files: string[] = []

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      if (el.dataset.type === "file") {
        text += el.textContent ?? ""
        files.push(el.dataset.path!)
        return
      }
      if (el.tagName === "BR") {
        text += "\n"
        return
      }
      for (const child of Array.from(el.childNodes)) {
        visit(child)
      }
    }

    for (const child of Array.from(editorRef.childNodes)) {
      visit(child)
    }

    return { text: text.replace(/\u200B/g, ""), files }
  }

  const handleInput = () => {
    mirror.input = true
    const rawText = getRawText()
    const trimmed = rawText.trim()
    setHasContent(trimmed.length > 0)

    const cursorPosition = getCursorPosition(editorRef)
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    if (atMatch && split.onFileSearch) {
      filterOnInput(atMatch[1])
      setShowPicker(true)
    } else {
      setShowPicker(false)
    }

    split.onInput(rawText)
  }

  const selectActive = () => {
    const items = flat()
    if (items.length === 0) return
    const activeKey = active()
    const item = items.find((entry) => entry.path === activeKey) ?? items[0]
    if (item) insertFilePill(item.path)
  }

  const submit = () => {
    const { text, files } = parseFromDOM()
    const trimmed = text.trim()
    if (!trimmed) return
    const uniqueFiles = [...new Set(files)]
    split.onSubmit(trimmed, uniqueFiles.length > 0 ? uniqueFiles : undefined)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showPicker()) {
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        selectActive()
        return
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || (e.ctrlKey && (e.key === "n" || e.key === "p"))) {
        e.preventDefault()
        e.stopPropagation()
        filterOnKeyDown(e)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        setShowPicker(false)
        return
      }
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      split.onCancel()
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      submit()
    }
  }

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData?.getData("text/plain") ?? ""
    document.execCommand("insertText", false, text)
  }

  onMount(() => {
    if (split.autofocus === false) return
    requestAnimationFrame(focus)
  })

  createEffect(() => {
    const value = split.value
    if (mirror.input) {
      mirror.input = false
      return
    }
    if (!editorRef) return
    editorRef.textContent = value
    setHasContent(value.trim().length > 0)
  })

  return (
    <LineCommentAnchor {...rest} open={true} variant="editor" onClick={() => focus()}>
      <div data-slot="line-comment-editor">
        <div data-slot="line-comment-editor-scroll">
          <div
            ref={editorRef}
            contenteditable="true"
            data-slot="line-comment-textarea"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <Show when={!hasContent()}>
            <div data-slot="line-comment-placeholder">
              {split.placeholder ?? i18n.t("ui.lineComment.placeholder")}
            </div>
          </Show>
        </div>
        <Show when={showPicker()}>
          <div data-slot="line-comment-file-picker" onMouseDown={(e) => e.preventDefault()}>
            <For each={flat().slice(0, 8)}>
              {(file) => (
                <button
                  type="button"
                  data-active={file.path === active() ? "" : undefined}
                  onClick={() => insertFilePill(file.path)}
                >
                  <FileIcon node={{ path: file.path, type: "file" }} class="size-4 shrink-0" />
                  <span class="truncate">
                    <span class="text-text-weak">{getDirectory(file.path)}</span>
                    <span>{getFilename(file.path)}</span>
                  </span>
                </button>
              )}
            </For>
            <Show when={flat().length === 0}>
              <div class="p-2 text-text-weak text-sm">{i18n.t("ui.list.empty")}</div>
            </Show>
          </div>
        </Show>
        <div data-slot="line-comment-actions">
          <div data-slot="line-comment-editor-label">
            {i18n.t("ui.lineComment.editorLabel.prefix")}
            {split.selection}
            {i18n.t("ui.lineComment.editorLabel.suffix")}
          </div>
          <Button size="small" variant="ghost" onClick={split.onCancel}>
            {split.cancelLabel ?? i18n.t("ui.common.cancel")}
          </Button>
          <Button size="small" variant="primary" disabled={!hasContent()} onClick={submit}>
            {split.submitLabel ?? i18n.t("ui.lineComment.submit")}
          </Button>
        </div>
      </div>
    </LineCommentAnchor>
  )
}
