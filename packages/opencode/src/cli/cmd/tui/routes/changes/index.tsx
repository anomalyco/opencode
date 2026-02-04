import { useRouteData, useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import { createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { FileList, order } from "./file-list"
import {
  commentSlots,
  getLineAnchor,
  makeKey,
  type Comment,
  type CommentInputState,
  type CommentSide,
} from "./comment-box"
import { SlottableDiff, type DiffLineClickInfo, type SlottableDiffProps } from "./slottable-diff"
import { Footer } from "./footer"
import { formatCommentsForAI, hasAnyComments } from "./format-comments"
import { formatPatch, structuredPatch } from "diff"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Identifier } from "@/id/id"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKV } from "../../context/kv.tsx"
import path from "node:path"

const SIDE_BAR_WIDTH = 40
export type CommentsByFile = Map<string, Map<string, Comment>>

export function Changes() {
  const routeData = useRouteData("changes")
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
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

  const [commentsByFile, setCommentsByFile] = createSignal<CommentsByFile>(new Map())
  const currentComments = createMemo(() => commentsByFile().get(currentFileKey()) ?? new Map())
  const hasComments = createMemo(() => hasAnyComments(commentsByFile()))
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
    if (current && current.line === info.visualLineIndex && current.side === side) {
      setStore("input", null)
      return
    }

    setStore("input", { line: info.visualLineIndex, side, lineType: info.type, anchor })
    setStore("focused", null)
  }

  function handleSubmitComment(line: number, side: CommentSide, text: string) {
    const lineType = store.input?.lineType ?? "context"
    const anchor = store.input?.anchor ?? `v:${line}`
    const key = makeKey(anchor, side)

    const newComment: Comment = {
      id: `${key}-${Date.now()}`,
      line,
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
    setStore("input", { line: comment.line, side, lineType, anchor: comment.anchor })
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

  function handleSubmitFeedback() {
    if (!hasComments()) return

    const selectedModel = local.model.current()
    if (!selectedModel) return

    const feedbackMessage = formatCommentsForAI(commentsByFile())

    // Send feedback
    sdk.client.session
      .prompt({
        sessionID: routeData.sessionID,
        messageID: Identifier.ascending("message"),
        agent: local.agent.current().name,
        model: selectedModel,
        variant: local.model.variant.current(),
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: feedbackMessage,
          },
        ],
      })
      .catch((err: Error) => {
        console.error("Error sending feedback:", err)
      })

    // Clear all comments
    setCommentsByFile(new Map())

    route.navigate({ type: "session", sessionID: routeData.sessionID })
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
    // Ctrl+Enter to submit feedback
    if (evt.ctrl && evt.name === "return" && store.pane === "diff" && !store.input) {
      evt.preventDefault()
      handleSubmitFeedback()
      return
    }

    // Escape to go back
    if (evt.name === "escape" && !store.input) {
      evt.preventDefault()
      route.navigate({ type: "session", sessionID: routeData.sessionID })
      return
    }

    // Tab to switch pane (file-list/diff)
    if (evt.name === "tab") {
      evt.preventDefault()
      const next = store.pane === "list" ? "diff" : "list"
      if (next === "list") {
        setStore("input", null)
      }
      setStore("pane", next)
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
      gap={0}
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
            <box paddingBottom={1}>
              <text fg={themeState.theme.textMuted}>{selectedFile()?.file}</text>
            </box>
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
      <Footer mode={store.pane} hasComments={hasComments()} />
    </box>
  )
}
