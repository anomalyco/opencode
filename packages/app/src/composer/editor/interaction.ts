import { Predicate } from "effect"
import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useFilteredList } from "@opencode/ui/hooks"
import { abort } from "@opencode/util/abort"
import { createComposerAttachments, type ComposerAttachmentConfig } from "../attachments/attachments"
import type { Upload } from "../attachments/uploads"
import { resolveBlobUrl } from "@/runtime/persistence/drafts"
import { createComposerEditorActions, type ComposerStateStoreInput } from "./actions"
import type {
  ComposerAttachment,
  ComposerComment,
  ComposerHistory,
  ComposerHistoryEntry,
  ComposerOption,
  ComposerPersistedState,
  ComposerSuggestion,
} from "../types"
import {
  createComposerInteractionState,
  transitionComposer,
  type ComposerInteractionCommand,
  type ComposerInteractionEvent,
} from "../suggestions/machine"
import { clonePrompt, isAttachment, promptLength } from "../prompt-parts"
import type { ComposerQueue } from "../adapter"
import { isCommentItem } from "../state"

export type ComposerSelectControl = {
  options: Accessor<ComposerOption[]>
  current: Accessor<string>
  onSelect: (id: string) => void
  keybind?: Accessor<string[]>
}

export type ComposerEditorView = {
  draftOnly?: boolean
  placeholder?: Accessor<string>
  add?: {
    onAttach: () => void
  }
  agent?: ComposerSelectControl
  variant?: ComposerSelectControl
  submit: {
    available?: Accessor<boolean>
    stopping: Accessor<boolean>
    /** A send pressed while agents and models load, which goes through once they do. */
    held?: Accessor<boolean>
    working?: Accessor<boolean>
    queue?: ComposerQueue
    onSubmit: (options?: { alternate?: boolean }) => void
    onStop: () => void
  }
  shell?: {
    onOpen: () => void
    onClose: () => void
  }
}

export function createComposerEditorState(mode: "normal" | "shell" = "normal") {
  return createStore({ ...createComposerInteractionState(), mode })
}

export function createComposerEditor(input: {
  store: ComposerStateStoreInput
  state?: ReturnType<typeof createComposerEditorState>
  history?: ComposerHistory
  commands: Accessor<ComposerSuggestion[]>
  context: Accessor<ComposerSuggestion[]>
  searchContextFiles: (query: string, signal?: AbortSignal) => ComposerSuggestion[] | Promise<ComposerSuggestion[]>
  /** Reads reactively, so newly found sessions refresh the list without waiting on file search. */
  searchSessions?: (query: string) => ComposerSuggestion[]
  /** Whether the session search for this query has yet to settle; reads reactively. */
  sessionsPending?: (query: string) => boolean
  openAttachment?: (attachment: ComposerAttachment, origin?: HTMLElement) => void
  /** An object URL for the image file at this path, which a path attachment references without its bytes. */
  readImage?: (path: string) => Promise<string | undefined>
  openContext?: (key: string) => void
  onContextRemove?: (item: ComposerComment) => void
  onQuoteComment?: (item: Extract<ComposerComment, { type: "quote" }>, comment: string) => void
  quoteComment?: { key: Accessor<string | undefined>; set: (key?: string) => void }
  onEditor?: (element: HTMLElement) => void
  onSuggestionSelect?: (item: ComposerSuggestion) => (() => void) | void
  view: ComposerEditorView
  attachments?: ComposerAttachmentConfig
}) {
  let editor: HTMLElement | undefined
  let fileInput: HTMLInputElement | undefined
  let focusFrame: number | undefined
  let focusCursor: number | undefined

  const cancelFocus = () => {
    if (focusFrame === undefined) return
    cancelAnimationFrame(focusFrame)
    focusFrame = undefined
    focusCursor = undefined
  }

  const flushFocus = () => {
    const cursor = focusCursor

    if (cursor === undefined) return
    cancelFocus()
    editor?.focus()
    setEditorCursor(editor, cursor)
  }

  onCleanup(cancelFocus)
  const draft = createComposerEditorActions(input.store)
  const [localQuoteComment, setLocalQuoteComment] = createSignal<string>()
  const quoteComment = input.quoteComment ?? { key: localQuoteComment, set: setLocalQuoteComment }
  const [state, setState] = input.state ?? createComposerEditorState(draft.state.mode)
  const [savedHistory, setSavedHistory] = createStore<{ entry?: ComposerHistoryEntry; cursor?: number }>({})
  const [cycle, setCycle] = createStore<{ index: number; entry?: ComposerHistoryEntry; cursor?: number }>({ index: -1 })
  const resetCycle = () => setCycle({ index: -1, entry: undefined, cursor: undefined })

  createEffect(on([() => draft.state, () => state.mode], resetCycle, { defer: true }))

  function addPart(part: ComposerPersistedState["prompt"][number]) {
    if (isAttachment(part)) return false

    if (part.type === "file" || part.type === "agent") {
      draft.addMention(part)

      return true
    }

    draft.addText(part.content)

    return true
  }

  const attachments = input.attachments
    ? createComposerAttachments({
        ...input.attachments,
        capture: () => ({
          current: () => draft.state.prompt,
          cursor: () => draft.state.cursor,
          set: (prompt, cursor) => draft.setPrompt(prompt, cursor),
        }),
        editor: () => editor,
        focusEditor: () => editor?.focus(),
        addPart,
        setDraggingType: (type) => dispatch({ type: type ? "drag.enter" : "drag.leave" }),
      })
    : undefined

  const attach = () => {
    resetCycle()

    if (!attachments) {
      input.view.add?.onAttach()

      return
    }

    // The add menu leaves focus on its trigger, so return it to the editor once files are picked.
    attachments.pick(
      () => fileInput?.click(),
      () => restoreFocus(),
    )
  }

  const [found, setFound] = createStore<{ query: string; files: ComposerSuggestion[] }>({ query: "", files: [] })
  let fileQuery: string | undefined
  let fileAbort = new AbortController()
  onCleanup(() => abort(fileAbort))

  // Debounced and abortable: each keystroke or close replaces the pending file search instead of queueing behind it.
  const findFiles = (query?: string) => {
    if (query === fileQuery) return
    abort(fileAbort)
    const controller = new AbortController()
    fileQuery = query
    fileAbort = controller

    if (query === undefined) return

    if (!query.trim() || /\s/.test(query)) return

    const timer = setTimeout(
      () =>
        void Promise.resolve(input.searchContextFiles(query, controller.signal)).then(
          (files) => !controller.signal.aborted && setFound({ query, files }),
          () => undefined,
        ),
      150,
    )

    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true })
  }

  const contextList = useFilteredList<ComposerSuggestion>({
    items: (query) => {
      if (state.popover.type !== "context") {
        findFiles(undefined)

        return []
      }

      findFiles(query)

      const sessions = input.searchSessions?.(query) ?? []

      // Only session titles contain spaces; fuzzy matches elsewhere would keep the popover over prose.
      if (/\s/.test(query)) return sessions

      const fixed = input.context().filter((item) => item.kind !== "file")
      const recent = input.context().filter((item) => item.kind === "file" && item.recent)

      const seen = new Set(recent.map((item) => item.id))

      const files = found.query === query ? found.files : []

      return [...fixed, ...sessions, ...recent, ...files.filter((item) => !seen.has(item.id))]
    },
    key: (item) => item.id,
    filterKeys: ["label"],
    skipFilter: (item) => item.kind === "session" || (item.kind === "file" && !item.recent),
    groupBy: (item) => {
      if (item.kind === "session") return "session"

      if (item.kind === "reference") return "reference"

      if (item.kind === "skill") return "skill"

      if (item.kind === "agent") return "agent"

      if (item.kind === "resource") return "resource"

      if (item.recent) return "recent"

      return "file"
    },
    sortGroupsBy: (a, b) => {
      const order = ["skill", "agent", "session", "reference", "resource", "recent", "file"]

      return order.indexOf(a.category) - order.indexOf(b.category)
    },
  })

  const commandList = useFilteredList<ComposerSuggestion>({
    items: () => input.commands(),
    key: (item) => item.id,
    filterKeys: ["trigger", "title"],
  })

  const list = () => (state.popover.type === "context" ? contextList : commandList)

  const history = createMemo<ComposerSuggestion[]>(() =>
    (input.history?.entries(state.mode) ?? []).map((entry, index) => ({
      id: `history:${index}`,
      kind: "history",
      label: entry.prompt.map((part) => ("content" in part ? part.content : "")).join(""),
      description: entry.prompt.flatMap((part) => (isAttachment(part) ? [part.filename] : [])).join(", "),
      history: entry,
    })),
  )

  const suggestions = () => {
    if (state.popover.type !== "history") return list().flat()
    const query = state.popover.query.trim().toLowerCase()

    return history()
      .filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query))
      .toReversed()
  }

  const execute = (command: ComposerInteractionCommand) => {
    if (command.type === "history.preview") {
      const item = history().find((entry) => entry.id === command.id)

      if (item?.history)
        applyHistory(item.history, { focus: state.popover.type === "history" && !state.popover.searching })

      return
    }

    if (command.type === "history.restore") {
      if (savedHistory.entry) applyHistory(savedHistory.entry, { cursor: savedHistory.cursor })

      return
    }

    if (command.type === "draft.setText") {
      draft.setText(command.value)

      return
    }

    if (command.type === "draft.addText") {
      draft.addText(command.value)

      return
    }

    if (command.type === "mention.add") {
      if (command.item.mention) draft.addMention(command.item.mention, command.range)

      return
    }

    if (command.type === "popover.filter") {
      ;(command.popover === "command" ? commandList : contextList).onInput(command.query)

      return
    }

    if (command.type === "suggestion.select") {
      const item = suggestions().find((entry) => entry.id === command.id)

      if (item) dispatch({ type: "popover.select", item })

      return
    }

    if (command.type === "focus.editor") {
      if (state.popover.type === "history") return restoreFocus()
      requestAnimationFrame(() => editor?.focus())
    }
  }

  function dispatch(event: ComposerInteractionEvent) {
    if (event.type === "history.search" || event.type === "popover.close") cancelFocus()

    if (
      event.type === "history.open" ||
      event.type === "commands.open" ||
      event.type === "context.open" ||
      event.type === "popover.select"
    )
      resetCycle()

    if (event.type === "popover.select" && event.item.kind === "history") {
      if (!event.item.history) return false
      setState({ popover: { type: "closed" }, focus: "editor" })
      applyHistory(event.item.history)
      setSavedHistory({ entry: undefined, cursor: undefined })

      return true
    }

    const mode = state.mode
    const result = transitionComposer(state, event, draft.state)
    const action = event.type === "popover.select" ? input.onSuggestionSelect?.(event.item) : undefined

    if (event.type === "popover.select") {
      if (!action) result.commands.forEach(execute)

      if (action && event.item.kind === "command" && state.popover.type !== "command-menu") {
        draft.setPrompt(draft.state.prompt.filter(isAttachment), 0)
      }
    }

    setState(reconcile(result.state))

    if (mode !== result.state.mode) draft.setMode(result.state.mode)

    if (event.type !== "popover.select") result.commands.forEach(execute)

    if (state.popover.type !== "history") setSavedHistory({ entry: undefined, cursor: undefined })

    if (mode !== result.state.mode) {
      if (result.state.mode === "shell") input.view.shell?.onOpen()

      if (result.state.mode === "normal") input.view.shell?.onClose()
    }

    if (event.type === "popover.select") {
      if (!action) return result.handled
      action()
    }

    return result.handled
  }

  const onKeyDown = (event: KeyboardEvent) => {
    flushFocus()

    if (
      state.popover.type === "history" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      !event.isComposing &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault()
      event.stopPropagation()
      dispatch({ type: "history.search" })

      return true
    }

    if (
      state.mode === "normal" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "u"
    ) {
      event.preventDefault()
      attach()

      return true
    }

    const handled = dispatch({
      type: "key.down",
      key: event.key,
      ctrl: event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey,
      composing: event.isComposing,
      ids: suggestions().map((item) => item.id),
      empty: draft.state.prompt.every((part) => !("content" in part) || part.content.length === 0),
    })

    if (handled) event.preventDefault()

    if (handled && event.key !== "Enter" && event.key !== "Tab" && state.popover.type !== "closed") {
      const activeID = state.popover.activeID ?? ""
      requestAnimationFrame(() =>
        document.querySelector(`[data-suggestion-id="${CSS.escape(activeID)}"]`)?.scrollIntoView({ block: "nearest" }),
      )
    }

    if (handled) return true

    if (event.key === "Escape" && input.view.submit.queue?.editing()) {
      event.preventDefault()
      input.view.submit.queue.cancelEdit()

      return true
    }

    const stop =
      (input.view.submit.working?.() || input.view.submit.held?.()) &&
      ((event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "g") ||
        event.key === "Escape")

    if (stop) {
      event.preventDefault()
      input.view.submit.onStop()

      return true
    }

    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.isComposing &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      (event.shiftKey
        ? event.key === "ArrowUp" && openHistory()
        : navigateHistory(event.key === "ArrowUp" ? "up" : "down"))
    ) {
      event.preventDefault()

      return true
    }

    return event.defaultPrevented
  }

  createEffect(() => {
    if (state.popover.type === "closed") return
    const ids = suggestions().map((item) => item.id)

    if (state.popover.activeID ? ids.includes(state.popover.activeID) : ids.length === 0) return
    dispatch({ type: "popover.results", ids })
  })

  // A space ends the mention once nothing matches, so `@` can still start ordinary prose.
  createEffect(() => {
    if (state.popover.type !== "context" || !/\s/.test(state.popover.query)) return

    if (input.sessionsPending?.(state.popover.query)) return

    if (contextList.grouped.state === "ready" && contextList.flat().length === 0) dispatch({ type: "popover.close" })
  })

  const restoreFocus = (cursor = draft.state.cursor ?? promptLength(draft.state.prompt)) => {
    cancelFocus()
    focusCursor = cursor
    focusFrame = requestAnimationFrame(flushFocus)
  }

  const applyHistory = (entry: ComposerHistoryEntry, options?: { focus?: boolean; cursor?: number }) => {
    input.history?.restore?.(entry.metadata)
    const cursor = options?.cursor ?? promptLength(entry.prompt)
    draft.setPrompt(clonePrompt(entry.prompt), cursor)

    if (options?.focus !== false) restoreFocus(cursor)
  }

  const openHistory = () => {
    if (state.popover.type !== "closed" || !editor || !history().length) return false
    const selection = window.getSelection()

    if (!selection?.isCollapsed || !editor.contains(selection.anchorNode)) return false

    if (draft.state.prompt.some((part) => "content" in part && part.content.length > 0)) return false
    setSavedHistory({
      entry: { prompt: clonePrompt(draft.state.prompt), metadata: input.history?.capture?.() },
      cursor: draft.state.cursor,
    })
    dispatch({ type: "history.open", id: history()[0]!.id })

    return true
  }

  const navigateHistory = (direction: "up" | "down") => {
    if (state.popover.type !== "closed" || !input.history || !editor) return false
    const selection = window.getSelection()

    if (!selection?.isCollapsed || !editor.contains(selection.anchorNode)) return false
    const text = draft.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")

    if (!canNavigateHistory(direction, text, editorCursor(editor), cycle.index >= 0)) return false
    const entries = input.history.entries(state.mode)

    if (direction === "up") {
      if (entries.length === 0 || cycle.index >= entries.length - 1) return false

      if (cycle.index === -1) {
        setCycle({
          entry: { prompt: clonePrompt(draft.state.prompt), metadata: input.history.capture?.() },
          cursor: draft.state.cursor,
        })
      }

      const index = cycle.index + 1
      setCycle("index", index)
      applyHistory(entries[index]!, { cursor: 0 })

      return true
    }

    if (cycle.index < 0 || !cycle.entry) return false

    if (cycle.index > 0) {
      const index = cycle.index - 1
      setCycle("index", index)
      applyHistory(entries[index]!)

      return true
    }

    applyHistory(cycle.entry, { cursor: cycle.cursor })
    resetCycle()

    return true
  }

  return {
    state,
    view: input.view,
    suggestions,
    dispatch,
    onKeyDown,
    value() {
      return draft.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")
    },
    parts() {
      return draft.state.prompt
    },
    contextItem(id: string) {
      return draft.state.context.items.find((item) => item.key === id)
    },
    comments() {
      return draft.state.context.items.filter(isCommentItem)
    },
    files() {
      return draft.state.context.items.flatMap((item) => (item.type === "file" && !item.comment?.trim() ? [item] : []))
    },
    attachments(): ComposerAttachment[] {
      return draft.state.prompt.filter(isAttachment)
    },
    uploads(): Upload[] {
      return attachments?.pending() ?? []
    },
    cancelUpload(id: string) {
      attachments?.cancel(id)
    },
    toggleContext(id: string) {
      dispatch({ type: "context.active", id })
      input.openContext?.(id)
    },
    editingQuote: () => quoteComment.key(),
    editQuote: (key?: string) => quoteComment.set(key),
    commentQuote(id: string, comment: string) {
      const item = draft.state.context.items.find((entry) => entry.key === id)

      if (item?.type === "quote") input.onQuoteComment?.(item, comment)
    },
    async searchPaths(query: string) {
      return (await input.searchContextFiles(query)).flatMap((item) => (item.path ? [item.path] : []))
    },
    removeContext(id: string) {
      resetCycle()
      const item = draft.state.context.items.find((entry) => entry.key === id)

      if (item) input.onContextRemove?.(item)
      draft.removeContext(id)

      if (state.activeContextID === id) dispatch({ type: "context.active", id })
    },
    openAttachment(attachment: ComposerAttachment, origin?: HTMLElement) {
      input.openAttachment?.(attachment, origin)
    },
    /** The image an attachment shows, whether its bytes are in the draft store or in a file at its path. */
    previewAttachment(attachment: ComposerAttachment): Promise<string | undefined> {
      if (!attachment.mime.startsWith("image/")) return Promise.resolve(undefined)

      if (attachment.type === "image") return resolveBlobUrl(attachment.blob)

      return input.readImage?.(attachment.path) ?? Promise.resolve(undefined)
    },
    removeAttachment(id: string) {
      resetCycle()
      draft.removeAttachment(id)
    },
    canSubmit() {
      if (input.view.submit.available?.() === false) return false

      if (input.view.draftOnly) return false

      if (attachments?.pending().length) return false
      const persisted = draft.state

      if (state.mode === "shell") {
        return persisted.prompt.some((part) => "content" in part && !!part.content.trim())
      }

      if (persisted.prompt.some(isAttachment)) return true

      if (persisted.context.items.some(isCommentItem)) return true

      return persisted.prompt.some((part) => "content" in part && !!part.content.trim())
    },
    setEditor(element: HTMLElement) {
      editor = element
      input.onEditor?.(element)
    },
    restoreFocus,
    onInput(value: string, prompt?: ComposerPersistedState["prompt"], cursor?: number) {
      cancelFocus()
      resetCycle()

      if (prompt) draft.setPrompt(prompt, cursor)

      if (input.view.draftOnly) return
      dispatch({ type: "input.changed", value, persist: !prompt })
    },
    onCursor(cursor: number) {
      draft.setCursor(cursor)
    },
    openCommands() {
      dispatch({ type: "commands.open" })
    },
    openContext() {
      dispatch({ type: "context.open" })
    },
    openShell() {
      dispatch({ type: "mode.shell" })
    },
    submit(options?: { alternate?: boolean }) {
      if (input.view.submit.available?.() === false) return

      if (input.view.draftOnly) return

      if (attachments?.pending().length) return
      resetCycle()
      input.view.submit.onSubmit(options)
      dispatch({ type: "popover.close" })
    },
    stop() {
      input.view.submit.onStop()
    },
    addHistory(prompt: ComposerPersistedState["prompt"], mode: "normal" | "shell") {
      resetCycle()
      input.history?.add(prompt, mode)
    },
    resetHistory() {
      resetCycle()

      if (state.popover.type === "history") dispatch({ type: "popover.close" })
    },
    onPaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      const text = clipboard?.getData("text/plain")

      if (attachments && shouldHandlePasteAsAttachment(clipboard, !!input.attachments?.readClipboardImage)) {
        resetCycle()
        void attachments.handlePaste(event)

        return
      }

      if (!text) return
      event.preventDefault()
      // insertText emits input events per line, repeatedly parsing and saving the draft.
      // Escaped HTML inserts multiline text once and preserves native selection and undo.
      const normalized = text.replace(/\r\n?/g, "\n")
      const multiline = normalized.includes("\n")

      const value = multiline
        ? normalized.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        : normalized

      if (
        Predicate.isFunction(document.execCommand) &&
        document.execCommand(multiline ? "insertHTML" : "insertText", false, value)
      )
        return
      const target = event.currentTarget
      const selection = window.getSelection()

      if (!(target instanceof HTMLElement) || !selection?.rangeCount || !target.contains(selection.anchorNode)) return
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const node = document.createTextNode(normalized)
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: normalized }))
    },
    onDragEnter(event: DragEvent) {
      event.preventDefault()
      dispatch({ type: "drag.enter" })
    },
    onDragOver(event: DragEvent) {
      event.preventDefault()
    },
    onDragLeave() {
      dispatch({ type: "drag.leave" })
    },
    onDrop(event: DragEvent) {
      event.preventDefault()
      dispatch({ type: "drag.leave" })

      if (attachments) {
        event.stopPropagation()
        void attachments.handleDrop(event)

        return
      }
    },
    attach,
    setFileInput(element: HTMLInputElement) {
      fileInput = element
    },
    addAttachments(files: File[]) {
      if (!attachments) return
      resetCycle()
      void attachments.addAttachments(files)
      restoreFocus()
    },
    setQuery(value: string) {
      dispatch({ type: "popover.query", value })
    },
  }
}

export type ComposerEditorModel = ReturnType<typeof createComposerEditor>

export function shouldHandlePasteAsAttachment(clipboard: DataTransfer | null, readClipboardImage: boolean) {
  if (Array.from(clipboard?.items ?? []).some((item) => item.kind === "file")) return true

  if (Array.from(clipboard?.types ?? []).some((type) => type.startsWith("text/"))) return false

  return readClipboardImage
}

function canNavigateHistory(direction: "up" | "down", text: string, cursor: number, inHistory: boolean) {
  const position = Math.max(0, Math.min(cursor, text.length))

  if (inHistory) return position === 0 || position === text.length

  if (direction === "up") return position === 0 && text.length === 0

  return position === text.length
}

function editorCursor(editor: HTMLElement) {
  const selection = window.getSelection()

  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return editor.textContent?.length ?? 0
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  range.setEnd(selection.anchorNode!, selection.anchorOffset)

  return range.toString().length
}

function setEditorCursor(editor: HTMLElement | undefined, cursor: number) {
  if (!editor) return
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let remaining = cursor
  let node = walker.nextNode()

  while (node) {
    const length = node.textContent?.length ?? 0

    if (remaining <= length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)

      return
    }

    remaining -= length
    node = walker.nextNode()
  }
}
