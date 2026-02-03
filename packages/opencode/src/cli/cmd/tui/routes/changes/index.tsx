import { useRouteData, useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { FileList, order } from "./file-list"
import { commentSlots, makeKey, type Comment, type CommentInputState, type CommentSide } from "./comment-box"
import { SlottableDiff, type DiffLineClickInfo, type SlottableDiffProps } from "./slottable-diff"
import { formatPatch, structuredPatch } from "diff"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKV } from "../../context/kv.tsx"
import path from "node:path"

const SIDE_BAR_WIDTH = 40

export function Changes() {
  const routeData = useRouteData("changes")
  const route = useRoute()
  const sync = useSync()
  const themeState = useTheme()
  const kv = useKV()
  const dimensions = useTerminalDimensions()
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()
  const [store, setStore] = createStore({
    pane: "list" as "list" | "diff",
    selected: 0,
    focused: null as string | null,
    input: null as CommentInputState | null,
  })
  const width = createMemo(() => dimensions().width - (store.pane === "list" ? SIDE_BAR_WIDTH + 1 : 1))

  const files = createMemo(() => sync.data.session_diff[routeData.sessionID] ?? [])
  const ordered = createMemo(() => order(files()))
  const selectedFile = createMemo(() => ordered()[store.selected])
  const currentFileKey = createMemo(() => selectedFile()?.file ?? "__none__")

  const [commentsByFile, setCommentsByFile] = createSignal<Map<string, Map<string, Comment>>>(new Map())
  const currentComments = createMemo(() => commentsByFile().get(currentFileKey()) ?? new Map())
  const [wrap] = kv.signal<"word" | "none">("diff_wrap_mode", "word")

  const filetype = createMemo(() => {
    const file = selectedFile()
    if (!file) return "none"
    const ext = path.extname(file.file)
    const language = LANGUAGE_EXTENSIONS[ext]
    if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
    return language ?? "none"
  })

  const fullDiff = createMemo(() => {
    const file = selectedFile()
    if (!file) return ""
    const patch = structuredPatch(file.file, file.file, file.before, file.after, "old", "new", { context: 3 })
    return formatPatch(patch)
  })

  const view = createMemo(() => {
    const diffStyle = sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    return dimensions().width > 120 ? "split" : "unified"
  })

  function handleLineClick(info: DiffLineClickInfo) {
    if (store.pane === "list") return
    if (info.type === "empty") return

    const lineIndex = info.visualLineIndex
    const lineType = info.type
    const side = view() === "split" ? info.side : "unified"
    const anchor = getLineAnchor(info)
    const key = makeKey(anchor, side)

    // If clicking line with existing comment, focus it
    if (currentComments().has(key)) {
      setStore("focused", key)
      setStore("input", null)
      return
    }

    // Toggle input for new comment
    const current = store.input
    if (current && current.line === lineIndex && current.side === side) {
      setStore("input", null)
      return
    }

    setStore("input", { line: lineIndex, side, lineType, anchor })
    setStore("focused", null)
  }

  function handleSubmitComment(line: number, side: CommentSide, text: string) {
    const input = store.input
    const lineType = input?.lineType ?? "context"
    const anchor = input?.anchor ?? `v:${line}`
    const key = makeKey(anchor, side)

    const newComment: Comment = {
      id: `${key}-${Date.now()}`,
      lineIndex: line,
      text,
      lineType,
      anchor,
    }
    setCommentsByFile((prev) => {
      const next = new Map(prev)
      const fileKey = currentFileKey()
      const fileComments = new Map(next.get(fileKey) ?? new Map())
      fileComments.set(key, newComment)
      next.set(fileKey, fileComments)
      return next
    })
    setStore("input", null)
  }

  function handleCancelInput() {
    setStore("input", null)
  }

  function handleEditComment(key: string) {
    const comment = currentComments().get(key)
    if (!comment) return

    // Parse key to get line and side
    const parts = key.split("-") as [string, CommentSide]
    const side = parts[1]
    const line = comment.lineIndex
    const lineType = comment.lineType ?? "context"

    // Delete comment and open input
    setCommentsByFile((prev) => {
      const next = new Map(prev)
      const fileKey = currentFileKey()
      const fileComments = new Map(next.get(fileKey) ?? new Map())
      fileComments.delete(key)
      next.set(fileKey, fileComments)
      return next
    })
    setStore("input", { line, side, lineType, anchor: comment.anchor })
    setStore("focused", null)
  }

  function handleDeleteComment(key: string) {
    setCommentsByFile((prev) => {
      const next = new Map(prev)
      const fileKey = currentFileKey()
      const fileComments = new Map(next.get(fileKey) ?? new Map())
      fileComments.delete(key)
      next.set(fileKey, fileComments)
      return next
    })
    setStore("focused", null)
  }

  function handleFocusComment(key: string) {
    setStore("focused", key)
    setStore("input", null)
  }

  const slots = () =>
    commentSlots({
      view: view(),
      input: store.input,
      comments: currentComments(),
      focused: store.focused,
      onSubmit: handleSubmitComment,
      onCancel: handleCancelInput,
      onEdit: handleEditComment,
      onDelete: handleDeleteComment,
      onFocus: handleFocusComment,
    })

  const diffProps = createMemo<SlottableDiffProps>(() => ({
    id: currentFileKey(),
    filetype: filetype(),
    syntaxStyle: themeState.syntax(),
    showLineNumbers: true,
    width: "100%",
    wrapMode: wrap(),
    virtualize: true,
    overscan: 30,
    fg: themeState.theme.text,
    addedBg: themeState.theme.diffAddedBg,
    removedBg: themeState.theme.diffRemovedBg,
    contextBg: themeState.theme.diffContextBg,
    addedSignColor: themeState.theme.diffHighlightAdded,
    removedSignColor: themeState.theme.diffHighlightRemoved,
    lineNumberFg: themeState.theme.textMuted,
    lineNumberBg: themeState.theme.diffContextBg,
    addedLineNumberBg: themeState.theme.diffAddedLineNumberBg,
    removedLineNumberBg: themeState.theme.diffRemovedLineNumberBg,
  }))

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      evt.preventDefault()
      const next = store.pane === "list" ? "diff" : "list"
      if (next === "list") {
        setStore("input", null)
      }
      setStore("pane", next)
      return
    }

    if (evt.name === "escape" && !store.input) {
      evt.preventDefault()
      route.navigate({ type: "session", sessionID: routeData.sessionID })
      return
    }

    // j/k scrolling only in diff view
    if (store.pane === "diff" && !store.input) {
      const box = scroll()
      if (!box) return

      switch (evt.name) {
        case "j":
          evt.preventDefault()
          box.scrollBy(3)
          return
        case "k":
          evt.preventDefault()
          box.scrollBy(-3)
          return
      }
    }
  })

  createEffect(() => {
    currentFileKey()
    setStore("input", null)
    setStore("focused", null)
    const box = scroll()
    if (!box) return
    box.scrollTo(0)
  })

  return (
    <box
      flexDirection="column"
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={themeState.theme.background}
    >
      <box flexGrow={1} flexDirection="row">
        {/* File List Pane */}
        {store.pane === "list" && (
          <FileList
            files={ordered()}
            selected={store.selected}
            onSelect={(index) => setStore("selected", index)}
            onSwitch={() => setStore("pane", "diff")}
            width={SIDE_BAR_WIDTH}
            focused={store.pane === "list"}
          />
        )}

        {/* Diff Pane */}
        {ordered().length > 0 ? (
          <scrollbox
            ref={setScroll}
            flexGrow={1}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            backgroundColor={themeState.theme.diffContextBg}
            scrollbarOptions={{ visible: false }}
          >
            <SlottableDiff
              diff={fullDiff()}
              view={view()}
              onLineClick={handleLineClick}
              lineSlots={slots()}
              {...diffProps()}
            />
          </scrollbox>
        ) : (
          <box width={width()} height="100%" paddingLeft={2} paddingTop={2}>
            <text fg={themeState.theme.textMuted}>No changes to display</text>
          </box>
        )}
      </box>
    </box>
  )
}

function getLineAnchor(info: DiffLineClickInfo): string {
  const data = info as DiffLineClickInfo & {
    oldLine?: number
    newLine?: number
    lineNumber?: number
  }

  const old = typeof data.oldLine === "number" ? data.oldLine : undefined
  const next = typeof data.newLine === "number" ? data.newLine : undefined
  const line = typeof data.lineNumber === "number" ? data.lineNumber : undefined

  if (info.side === "left" && old !== undefined) return `old:${old}`
  if (info.side === "right" && next !== undefined) return `new:${next}`

  if (line !== undefined) return `ln:${line}`
  if (next !== undefined) return `new:${next}`
  if (old !== undefined) return `old:${old}`

  return `v:${info.visualLineIndex}`
}
