import { createEffect, on, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createPromptInputV2Attachments, type PromptInputV2AttachmentConfig } from "./attachments"
import { createPromptInputV2Store, type PromptInputV2StoreInput } from "./store"
import type {
  PromptInputV2Attachment,
  PromptInputV2Comment,
  PromptInputV2History,
  PromptInputV2HistoryEntry,
  PromptInputV2Option,
  PromptInputV2PersistedState,
  PromptInputV2Suggestion,
} from "./types"
import {
  createPromptInputV2InteractionState,
  transitionPromptInputV2,
  type PromptInputV2InteractionCommand,
  type PromptInputV2InteractionEvent,
} from "./machine"

export type PromptInputV2SelectControl = {
  options: Accessor<PromptInputV2Option[]>
  current: Accessor<string>
  onSelect: (id: string) => void
}

export type PromptInputV2ViewConfig = {
  placeholder?: Accessor<string>
  add?: {
    onAttach: () => void
  }
  agent?: PromptInputV2SelectControl
  model?: PromptInputV2SelectControl
  variant?: PromptInputV2SelectControl
  submit: {
    stopping: Accessor<boolean>
    working?: Accessor<boolean>
    onSubmit: () => void
    onStop: () => void
  }
  shell?: {
    onOpen: () => void
    onClose: () => void
  }
  onKeyDown?: (event: KeyboardEvent) => void
  onPaste?: (event: ClipboardEvent) => void
  onDrop?: (event: DragEvent) => void
}

export function createPromptInputV2State() {
  return createStore(createPromptInputV2InteractionState())
}

export function createPromptInputV2Controller(input: {
  store: PromptInputV2StoreInput
  state?: ReturnType<typeof createPromptInputV2State>
  identity?: Accessor<unknown>
  history?: PromptInputV2History
  commands: Accessor<PromptInputV2Suggestion[]>
  context: Accessor<PromptInputV2Suggestion[]>
  searchContextFiles: (query: string) => PromptInputV2Suggestion[] | Promise<PromptInputV2Suggestion[]>
  openAttachment?: (attachment: PromptInputV2Attachment) => void
  openContext?: (key: string) => void
  onContextRemove?: (item: PromptInputV2Comment) => void
  onEditor?: (element: HTMLElement) => void
  onSuggestionSelect?: (item: PromptInputV2Suggestion) => (() => void) | void
  view: PromptInputV2ViewConfig
  attachments?: PromptInputV2AttachmentConfig
}) {
  let editor: HTMLElement | undefined
  let fileInput: HTMLInputElement | undefined
  const draft = createPromptInputV2Store(input.store)
  const [state, setState] = input.state ?? createPromptInputV2State()
  if (input.identity) {
    createEffect(on(input.identity, () => setState(reconcile(createPromptInputV2InteractionState())), { defer: true }))
  }
  function addPart(part: PromptInputV2PersistedState["prompt"][number]) {
    if (part.type === "image") return false
    if (part.type === "file" || part.type === "agent") {
      draft.addMention(part)
      return true
    }
    const text = draft.state.prompt.map((item) => ("content" in item ? item.content : "")).join("")
    const cursor = draft.state.cursor ?? text.length
    draft.setText(text.slice(0, cursor) + part.content + text.slice(cursor))
    return true
  }
  const attachments = input.attachments
    ? createPromptInputV2Attachments({
        ...input.attachments,
        capture: () => ({
          current: () => draft.state.prompt,
          cursor: () => draft.state.cursor,
          set: draft.setPrompt,
        }),
        editor: () => editor,
        focusEditor: () => editor?.focus(),
        addPart,
        setDraggingType: (type) => dispatch({ type: type ? "drag.enter" : "drag.leave" }),
      })
    : undefined
  const attach = () => {
    if (!attachments) {
      input.view.add?.onAttach()
      return
    }
    attachments.pick(() => fileInput?.click())
  }
  const contextList = useFilteredList<PromptInputV2Suggestion>({
    items: async (query) => {
      const fixed = input.context().filter((item) => item.kind !== "file")
      const recent = input.context().filter((item) => item.kind === "file" && item.recent)
      if (!query.trim()) return [...fixed, ...recent]
      const seen = new Set(recent.map((item) => item.id))
      const files = (await input.searchContextFiles(query)).filter((item) => !seen.has(item.id))
      return [...fixed, ...recent, ...files]
    },
    key: (item) => item.id,
    filterKeys: ["label"],
    skipFilter: (item) => item.kind === "file" && !item.recent,
    groupBy: (item) => {
      if (item.kind === "reference") return "reference"
      if (item.kind === "agent") return "agent"
      if (item.kind === "resource") return "resource"
      if (item.recent) return "recent"
      return "file"
    },
    sortGroupsBy: (a, b) => {
      const order = ["reference", "agent", "resource", "recent", "file"]
      return order.indexOf(a.category) - order.indexOf(b.category)
    },
  })
  const commandList = useFilteredList<PromptInputV2Suggestion>({
    items: () => input.commands(),
    key: (item) => item.id,
    filterKeys: ["trigger", "title"],
  })
  const list = () => (state.popover.type === "context" ? contextList : commandList)
  const suggestions = () => list().flat()

  const execute = (command: PromptInputV2InteractionCommand) => {
    if (command.type === "draft.setText") {
      draft.setText(command.value)
      return
    }
    if (command.type === "mention.add") {
      if (command.item.mention) draft.addMention(command.item.mention)
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
    if (command.type === "focus.editor") requestAnimationFrame(() => editor?.focus())
  }

  function dispatch(event: PromptInputV2InteractionEvent) {
    const mode = state.mode
    const result = transitionPromptInputV2(state, event, draft.state)
    setState(reconcile(result.state))
    result.commands.forEach(execute)
    if (mode !== result.state.mode) {
      if (result.state.mode === "shell") input.view.shell?.onOpen()
      if (result.state.mode === "normal") input.view.shell?.onClose()
    }
    if (event.type === "popover.select") {
      const action = input.onSuggestionSelect?.(event.item)
      if (!action) return result.handled
      if (event.item.kind === "command") {
        draft.setPrompt(
          draft.state.prompt.filter((part): part is PromptInputV2Attachment => part.type === "image"),
          0,
        )
      }
      action()
    }
    return result.handled
  }

  const onKeyDown = (event: KeyboardEvent) => {
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
    const stop =
      input.view.submit.working?.() &&
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
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      navigateHistory(event.key === "ArrowUp" ? "up" : "down")
    ) {
      event.preventDefault()
      return true
    }
    input.view.onKeyDown?.(event)
    return event.defaultPrevented
  }

  createEffect(() => {
    if (state.popover.type === "closed") return
    const ids = suggestions().map((item) => item.id)
    if (state.popover.activeID ? ids.includes(state.popover.activeID) : ids.length === 0) return
    dispatch({ type: "popover.results", ids })
  })

  const restoreFocus = (cursor = draft.state.cursor ?? promptLength(draft.state.prompt)) => {
    requestAnimationFrame(() => {
      editor?.focus()
      setEditorCursor(editor, cursor)
    })
  }

  const applyHistory = (entry: PromptInputV2HistoryEntry, position: "start" | "end") => {
    input.history?.restore?.(entry.metadata)
    const cursor = position === "start" ? 0 : promptLength(entry.prompt)
    draft.setPrompt(clonePrompt(entry.prompt), cursor)
    restoreFocus(cursor)
  }
  const navigateHistory = (direction: "up" | "down") => {
    if (!input.history || !editor) return false
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !editor.contains(selection.anchorNode)) return false
    const text = draft.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")
    if (!canNavigateHistory(direction, text, editorCursor(editor), state.historyIndex >= 0)) return false
    const entries = input.history.entries(state.mode)
    if (direction === "up") {
      if (entries.length === 0 || state.historyIndex >= entries.length - 1) return false
      if (state.historyIndex === -1) {
        setState("savedHistory", {
          prompt: clonePrompt(draft.state.prompt),
          metadata: input.history.capture?.(),
        })
      }
      const index = state.historyIndex + 1
      setState("historyIndex", index)
      applyHistory(entries[index]!, "start")
      return true
    }
    if (state.historyIndex < 0) return false
    if (state.historyIndex > 0) {
      const index = state.historyIndex - 1
      setState("historyIndex", index)
      applyHistory(entries[index]!, "end")
      return true
    }
    const saved = state.savedHistory ?? { prompt: [{ type: "text", content: "", start: 0, end: 0 }] }
    setState({ historyIndex: -1, savedHistory: undefined })
    applyHistory(saved, "end")
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
    addPart,
    contextItem(id: string) {
      return draft.state.context.items.find((item) => item.key === id)
    },
    comments() {
      return draft.state.context.items.filter((item) => !!item.comment?.trim())
    },
    attachments(): PromptInputV2Attachment[] {
      return draft.state.prompt.filter((part): part is PromptInputV2Attachment => part.type === "image")
    },
    toggleContext(id: string) {
      dispatch({ type: "context.active", id })
      input.openContext?.(id)
    },
    removeContext(id: string) {
      const item = draft.state.context.items.find((entry) => entry.key === id)
      if (item) input.onContextRemove?.(item)
      draft.removeContext(id)
      if (state.activeContextID === id) dispatch({ type: "context.active", id })
    },
    openAttachment(attachment: PromptInputV2Attachment) {
      input.openAttachment?.(attachment)
    },
    removeAttachment(id: string) {
      draft.removeAttachment(id)
    },
    canSubmit() {
      const persisted = draft.state
      if (persisted.prompt.some((part) => part.type === "image")) return true
      if (persisted.context.items.some((item) => !!item.comment?.trim())) return true
      return persisted.prompt.some((part) => "content" in part && !!part.content.trim())
    },
    setEditor(element: HTMLElement) {
      editor = element
      input.onEditor?.(element)
    },
    restoreFocus,
    onInput(value: string, prompt?: PromptInputV2PersistedState["prompt"], cursor?: number) {
      if (prompt) draft.setPrompt(prompt, cursor)
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
    closeShell() {
      dispatch({ type: "mode.normal" })
    },
    submit() {
      input.view.submit.onSubmit()
      dispatch({ type: "popover.close" })
    },
    stop() {
      input.view.submit.onStop()
    },
    addHistory(prompt: PromptInputV2PersistedState["prompt"], mode: "normal" | "shell") {
      input.history?.add(prompt, mode)
      setState({ historyIndex: -1, savedHistory: undefined })
    },
    resetHistory() {
      setState({ historyIndex: -1, savedHistory: undefined })
    },
    onPaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      if (
        attachments &&
        (Array.from(clipboard?.items ?? []).some((item) => item.kind === "file") || !clipboard?.getData("text/plain"))
      ) {
        void attachments.handlePaste(event)
        return
      }
      input.view.onPaste?.(event)
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
      input.view.onDrop?.(event)
    },
    attach,
    setFileInput(element: HTMLInputElement) {
      fileInput = element
    },
    addAttachments(files: File[]) {
      if (attachments) void attachments.addAttachments(files)
    },
    setQuery(value: string) {
      dispatch({ type: "popover.query", value })
    },
  }
}

export type PromptInputV2Interaction = ReturnType<typeof createPromptInputV2Controller>

function canNavigateHistory(direction: "up" | "down", text: string, cursor: number, inHistory: boolean) {
  const position = Math.max(0, Math.min(cursor, text.length))
  if (inHistory) return position === 0 || position === text.length
  if (direction === "up") return position === 0 && text.length === 0
  return position === text.length
}

function clonePrompt(prompt: PromptInputV2PersistedState["prompt"]): PromptInputV2PersistedState["prompt"] {
  return prompt.map((part) =>
    part.type === "file" ? { ...part, selection: part.selection ? { ...part.selection } : undefined } : { ...part },
  )
}

function promptLength(prompt: PromptInputV2PersistedState["prompt"]) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
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
