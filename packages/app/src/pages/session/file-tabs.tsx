import { createEffect, createMemo, createSignal, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic, Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/ui/line-comment-annotations"
import { sampledChecksum } from "@opencode-ai/shared/util/encode"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Markdown } from "@opencode-ai/ui/markdown"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { invoke } from "@tauri-apps/api/core"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import CodeMirrorView from "@/components/code-mirror-view"
import { langFromExt } from "@/utils/lang-from-ext"
import { isBinary, tooLarge } from "@/utils/file-limits"

function isMarkdownPath(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".markdown")
}

function rangeAt(source: string, offset: number, len: number) {
  const before = source.slice(0, offset)
  const inner = source.slice(offset, offset + len)
  const start = (before.match(/\n/g)?.length ?? 0) + 1
  const end = start + (inner.match(/\n/g)?.length ?? 0)
  return { start, end }
}

// 构建归一化空白后的字符串 + 原 offset 映射,用于宽松匹配。
function normalizeWithMap(s: string): { text: string; back: number[] } {
  const back: number[] = []
  let out = ""
  let prevSpace = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      if (!prevSpace && out.length > 0) {
        out += " "
        back.push(i)
      }
      prevSpace = true
    } else {
      out += c
      back.push(i)
      prevSpace = false
    }
  }
  return { text: out, back }
}

// 把选中文字映射回源码行号区间(1-based)。
// 1. 精确 indexOf;2. 归一化空白后再 indexOf(应对跨行选中的表格/列表,DOM text 中空白被压缩)。
// 都失败 → null,调用方走无 selection 分支(commentID 兜底去重)。
function findLineRange(source: string, needle: string): { start: number; end: number } | null {
  if (!source || !needle) return null
  const trimmed = needle.trim()
  if (!trimmed) return null

  const idx = source.indexOf(trimmed)
  if (idx >= 0) return rangeAt(source, idx, trimmed.length)

  const { text: nSource, back } = normalizeWithMap(source)
  const nNeedle = trimmed.replace(/[\s]+/g, " ")
  const nIdx = nSource.indexOf(nNeedle)
  if (nIdx < 0 || nIdx >= back.length) return null

  const srcStart = back[nIdx]
  const endNIdx = Math.min(nIdx + nNeedle.length, back.length - 1)
  const srcEnd = back[endNIdx] ?? source.length
  return rangeAt(source, srcStart, Math.max(1, srcEnd - srcStart))
}

function truncatePreview(text: string, max = 500): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (collapsed.length <= max) return collapsed
  return collapsed.slice(0, max) + "…"
}

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function FileTabContent(props: { tab: string }) {
  const file = useFile()
  const sdk = useSDK()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))

  // === editable viewer state (Phase 2 editable file viewer + Phase 3 guardrails) ===
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal<string | null>(null)
  const [loadedMtime, setLoadedMtime] = createSignal<number | null>(null)
  const dirty = createMemo(() => {
    const d = draft()
    return d !== null && d !== contents()
  })
  const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  const canEdit = () => {
    if (!isTauri()) return false
    const p = path()
    if (!p) return false
    if (isBinary(p)) return false
    if (tooLarge(contents())) return false
    return true
  }
  const editDisabledReason = () => {
    if (!isTauri()) return "Edit only available in desktop app"
    const p = path()
    if (!p) return undefined
    if (isBinary(p)) return "Binary file cannot be edited"
    if (tooLarge(contents())) return "File >10MB, editing disabled"
    return undefined
  }
  const startEdit = async () => {
    const p = path()
    const root = sdk.directory
    if (!p || !root) return
    try {
      const mtime = await invoke<number>("get_file_mtime", { root, path: p })
      setLoadedMtime(mtime)
    } catch (e) {
      // 拿不到 mtime(文件可能不存在、权限问题)→ mtime 检测跳过(传 null)
      setLoadedMtime(null)
      console.warn("get_file_mtime failed, skipping mtime check:", e)
    }
    setDraft(contents())
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    setDraft(null)
    setLoadedMtime(null)
  }
  const performWrite = async (root: string, p: string, content: string, expectedMtime: number | null) => {
    await invoke("write_text_file", { root, path: p, content, expectedMtime })
  }
  const reloadAndExitEdit = async (p: string) => {
    setEditing(false)
    setDraft(null)
    setLoadedMtime(null)
    await file.load(p, { force: true })
  }
  const saveEdit = async () => {
    const p = path()
    const root = sdk.directory
    if (!p || !root || draft() === null) return
    try {
      await performWrite(root, p, draft() ?? "", loadedMtime())
      await reloadAndExitEdit(p)
      showToast({ variant: "success", title: "Saved" })
    } catch (e) {
      const msg = String(e)
      if (msg.includes("mtime_conflict")) {
        const overwrite = window.confirm(
          "⚠ 磁盘上的这个文件已被其他程序修改(可能是 AI 或外部编辑器)。\n\n" +
            "[确定] 覆盖磁盘版本,保存我的改动\n" +
            "[取消] 丢弃我的改动,重新加载磁盘版本",
        )
        if (overwrite) {
          try {
            await performWrite(root, p, draft() ?? "", null)
            await reloadAndExitEdit(p)
            showToast({ variant: "success", title: "Overwritten" })
          } catch (e2) {
            showToast({ variant: "error", title: `Overwrite failed: ${e2}` })
          }
        } else {
          await reloadAndExitEdit(p)
          showToast({ variant: "success", title: "Reloaded from disk" })
        }
      } else if (msg.includes("readonly:")) {
        showToast({ variant: "error", title: "File is read-only, cannot save" })
      } else {
        showToast({ variant: "error", title: `Save failed: ${e}` })
      }
    }
  }
  // close editing when tab/path switches
  createEffect(
    on(
      path,
      () => {
        if (editing()) {
          setEditing(false)
          setDraft(null)
        }
      },
      { defer: true },
    ),
  )
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  // 右键选中文字弹自定义菜单(2 项:复制 / + 添加到聊天窗口)
  // 点 "+ 添加到聊天窗口" 切到输入面板,用户写问题/修改意见,提交后选中文字 + 评论一起加进聊天上下文
  type MdMenuMode = "menu" | "input"
  type MdMenuState = { open: boolean; x: number; y: number; text: string; mode: MdMenuMode }
  const [mdMenu, setMdMenu] = createSignal<MdMenuState>({ open: false, x: 0, y: 0, text: "", mode: "menu" })
  const [mdComment, setMdComment] = createSignal("")

  // 持久化选区高亮:textarea 获取焦点后 window.getSelection 会 collapse,
  // 用 CSS Custom Highlight API 单独画一层背景色保持视觉指示。
  const setSelectionHighlight = (range: Range | null) => {
    const css = (typeof window !== "undefined" ? (window as any).CSS : undefined) as
      | { highlights?: { set: (k: string, v: unknown) => void; delete: (k: string) => void } }
      | undefined
    const HighlightCtor = (typeof window !== "undefined" ? (window as any).Highlight : undefined) as
      | (new (range: Range) => unknown)
      | undefined
    if (!css?.highlights || !HighlightCtor) return
    if (!range) {
      css.highlights.delete("md-quote-active")
      return
    }
    try {
      css.highlights.set("md-quote-active", new HighlightCtor(range))
    } catch {
      // ignore
    }
  }

  // 一次性注入 ::highlight 样式
  onMount(() => {
    if (typeof document === "undefined") return
    if (document.getElementById("md-quote-highlight-style")) return
    const style = document.createElement("style")
    style.id = "md-quote-highlight-style"
    style.textContent = `::highlight(md-quote-active){background-color:rgba(255,196,0,0.35);color:inherit;}`
    document.head.appendChild(style)
  })

  const closeMdMenu = () => {
    setMdMenu((m) => (m.open ? { ...m, open: false } : m))
    setMdComment("")
    setSelectionHighlight(null)
  }

  const handleSelectionContextMenu = (event: MouseEvent) => {
    if (editing()) return // 编辑态让 CodeMirror 拿到原生右键菜单
    const selObj = typeof window !== "undefined" ? window.getSelection() : null
    const text = selObj?.toString() ?? ""
    event.preventDefault()
    if (text.trim() && selObj && selObj.rangeCount > 0) {
      setSelectionHighlight(selObj.getRangeAt(0).cloneRange())
    }
    setMdComment("")
    setMdMenu({ open: true, x: event.clientX, y: event.clientY, text, mode: "menu" })
  }

  const startEditFromMenu = () => {
    closeMdMenu()
    if (canEdit() && state()?.loaded) void startEdit()
  }

  const copyMdSelection = () => {
    const text = mdMenu().text
    if (text && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {})
    }
    closeMdMenu()
  }

  const openMdInputPanel = () => {
    setMdMenu((m) => ({ ...m, mode: "input" }))
  }

  const submitMdSelection = () => {
    const m = mdMenu()
    const p = path()
    const comment = mdComment().trim()
    closeMdMenu()
    if (!p || !m.text.trim()) return
    const range = findLineRange(contents(), m.text)
    const uid = `md-sel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    prompt.context.add({
      type: "file",
      path: p,
      selection: range ? selectionFromLines(range) : undefined,
      preview: truncatePreview(m.text),
      comment: comment || undefined,
      commentID: uid,
      commentOrigin: "file",
    })
    showToast({ variant: "success", title: comment ? "已加入聊天上下文(含问题)" : "已加入聊天上下文" })
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges()
  }

  createEffect(() => {
    if (!mdMenu().open) return
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('[data-slot="md-selection-menu"]')) return
      closeMdMenu()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMdMenu()
    }
    document.addEventListener("mousedown", onDocDown, true)
    document.addEventListener("keydown", onEsc, true)
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocDown, true)
      document.removeEventListener("keydown", onEsc, true)
    })
  })

  const renderMarkdown = (source: string) => (
    <div class="relative pb-40 px-6 py-4 select-text" onContextMenu={handleSelectionContextMenu}>
      <Markdown text={source} cacheKey={cacheKey()} />
    </div>
  )

  const renderFile = (source: string) => {
    if (isMarkdownPath(path())) return renderMarkdown(source)
    return (
      <div class="relative overflow-hidden pb-40" onContextMenu={handleSelectionContextMenu}>
        <Dynamic
          component={fileComponent}
          mode="text"
          file={{
            name: path() ?? "",
            contents: source,
            cacheKey: cacheKey(),
          }}
          enableLineSelection
          enableHoverUtility
          selectedLines={activeSelection()}
          commentedLines={commentedLines()}
          onRendered={() => {
            scrollSync.queueRestore()
          }}
          annotations={commentsUi.annotations()}
          renderAnnotation={commentsUi.renderAnnotation}
          renderHoverUtility={commentsUi.renderHoverUtility}
          onLineSelected={(range: SelectedLineRange | null) => {
            commentsUi.onLineSelected(range)
          }}
          onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
          onLineSelectionEnd={(range: SelectedLineRange | null) => {
            commentsUi.onLineSelectionEnd(range)
          }}
          search={search}
          class="select-text"
          media={{
            mode: "auto",
            path: path(),
            current: state()?.content,
            onLoad: scrollSync.queueRestore,
            onError: (args: { kind: "image" | "audio" | "svg" }) => {
              if (args.kind !== "svg") return
              showToast({
                variant: "error",
                title: language.t("toast.file.loadFailed.title"),
              })
            },
          }}
        />
      </div>
    )
  }

  return (
    <Tabs.Content value={props.tab} class="mt-3 relative h-full flex flex-col">
      <Show when={editing()}>
        <div class="flex items-center justify-between px-4 py-1.5 border-b border-border-base bg-surface-raised-stronger-non-alpha shadow-sm">
          <button
            onClick={saveEdit}
            disabled={!dirty()}
            class="text-xs px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover disabled:opacity-50"
          >
            保存{dirty() ? " *" : ""}
          </button>
          <button
            onClick={cancelEdit}
            class="text-xs px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
          >
            关闭
          </button>
        </div>
      </Show>
      <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
        <Switch>
          <Match when={editing() && state()?.loaded}>
            <div class="relative overflow-hidden p-2" style={{ "min-height": "300px" }}>
              <CodeMirrorView
                value={contents()}
                language={langFromExt(path() ?? "")}
                onChange={setDraft}
              />
            </div>
          </Match>
          <Match when={state()?.loaded}>{renderFile(contents())}</Match>
          <Match when={state()?.loading}>
            <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
          </Match>
          <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
        </Switch>
      </ScrollView>
      <Show when={mdMenu().open}>
        <Portal mount={document.body}>
          <Switch>
            <Match when={mdMenu().mode === "menu"}>
              <div
                data-slot="md-selection-menu"
                class="fixed z-50 min-w-[220px] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] py-1 text-sm"
                style={{ left: `${mdMenu().x}px`, top: `${mdMenu().y}px` }}
              >
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!mdMenu().text.trim()}
                  onClick={openMdInputPanel}
                >
                  添加到聊天窗口
                </button>
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!canEdit() || !state()?.loaded}
                  title={editDisabledReason()}
                  onClick={startEditFromMenu}
                >
                  编辑
                </button>
                <div class="my-1 border-t border-border-base" />
                <button
                  class="w-full px-3 py-1.5 hover:bg-surface-base-hover flex justify-between items-center gap-6 disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!mdMenu().text.trim()}
                  onClick={copyMdSelection}
                >
                  <span>复制</span>
                  <span class="text-xs text-text-weak">Ctrl+C</span>
                </button>
              </div>
            </Match>
            <Match when={mdMenu().mode === "input"}>
              <div
                data-slot="md-selection-menu"
                class="fixed z-50 w-[360px] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] p-3 text-sm flex flex-col gap-2"
                style={{ left: `${mdMenu().x}px`, top: `${mdMenu().y}px` }}
              >
                <textarea
                  ref={(el) => queueMicrotask(() => el.focus())}
                  class="w-full min-h-[80px] rounded border border-border-base bg-background-base px-2 py-1.5 text-sm text-text-strong placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-text-interactive-base resize-y"
                  placeholder="想怎么改 / 想问什么..."
                  value={mdComment()}
                  onInput={(e) => setMdComment(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      submitMdSelection()
                    }
                  }}
                />
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-text-weak">Ctrl+Enter 提交 · Esc 取消</span>
                  <div class="flex items-center gap-2">
                    <button
                      class="text-xs px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
                      onClick={closeMdMenu}
                    >
                      取消
                    </button>
                    <button
                      class="text-xs px-2 py-1 rounded border border-border-base bg-surface-base hover:bg-surface-base-hover"
                      onClick={submitMdSelection}
                    >
                      加入聊天
                    </button>
                  </div>
                </div>
              </div>
            </Match>
          </Switch>
        </Portal>
      </Show>
    </Tabs.Content>
  )
}
