import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic, Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/ui/line-comment-annotations"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
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
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
// FORK: .md 导出 Word [feat: md-export-pdf-word] 2026-05-05
// PDF 路线 v1 drop(Tauri WKWebView window.print silent,见 spec §9.6)
import { exportMdAsDocx } from "@/utils/md-export-docx"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import CodeMirrorView, { type CursorInfo } from "@/components/code-mirror-view"
// FORK: md-editing-iter-2 — 编辑态状态栏(行/列/选中字符数)2026-05-09
import CmStatusBar from "@/components/cm-status-bar"
import { langFromExt } from "@/utils/lang-from-ext"
// FORK: .md 编辑增强(列表续延 / Ctrl+B/I/K / 拖图 / 智能粘贴 / Ctrl+F 等)2026-05-05
import { markdownEditorExtensions } from "@/utils/markdown-editor-extensions"
import { isBinary, isOfficeDocument, tooLarge } from "@/utils/file-limits"
// FORK: 本地资源 protocol(.md 内 <img>/<video>/<audio> 重写 + HTML 预览 iframe)2026-05-05
import { localAssetUrl, resolveAbsolute, rewriteAssetSrc } from "@/utils/local-asset"
// FORK: 大文件预览统一防护 — L4 UX 兜底组件 [feat: large-file-preview-guard] 2026-05-21
import { FileTooLarge } from "@/components/file-too-large"
// FORK: debounce auto-save + flush [feat: auto-save-debounce-flush] 2026-05-21
import { createDebounced } from "@/utils/debounce"
// FORK: .md frontmatter 隐藏(Obsidian 风)2026-05-05
import { stripFrontmatter } from "@/utils/markdown-frontmatter"
// FORK: 聊天输入框焦点跟随 [feat: chat-input-focus-follow] 2026-05-21
import { focusChatInput } from "@/utils/chat-input-focus"

// FORK: macOS 平台检测,用于右键菜单输入框 Option+Enter 提交支持 2026-04-30
const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform)

function isMarkdownPath(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".markdown")
}

// FORK: HTML 预览支持 2026-05-05
function isHtmlPath(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  return lower.endsWith(".html") || lower.endsWith(".htm")
}

// HTML 预览大文件阈值 — 对齐 file-limits.ts MAX_EDITABLE_BYTES(预览与编辑同卡 10MB)
// FORK: 2026-05-14 2MB → 10MB,user 反馈大 PPT / Slides 常见 >2MB,旧阈值过保守
const HTML_PREVIEW_MAX_BYTES = 10 * 1024 * 1024

// 文件路径父目录(forward slash;支持 Windows 反斜杠)
function pathDirname(p: string): string {
  const fwd = p.replace(/\\/g, "/")
  const idx = fwd.lastIndexOf("/")
  return idx >= 0 ? fwd.slice(0, idx) : ""
}

// In-memory LRU cache for fetched office PDF binaries. Saves having to re-fetch
// 200+ MB across tab switches. Bounded so RAM doesn't grow unboundedly.
const OFFICE_PDF_CACHE_MAX = 2
const officePdfCache = new Map<string, Uint8Array>()
function officePdfCacheGet(key: string): Uint8Array | undefined {
  const value = officePdfCache.get(key)
  if (value) {
    officePdfCache.delete(key)
    officePdfCache.set(key, value) // bump to most-recent
  }
  return value
}
function officePdfCacheSet(key: string, value: Uint8Array) {
  if (officePdfCache.has(key)) officePdfCache.delete(key)
  officePdfCache.set(key, value)
  while (officePdfCache.size > OFFICE_PDF_CACHE_MAX) {
    const oldest = officePdfCache.keys().next().value
    if (oldest === undefined) break
    officePdfCache.delete(oldest)
  }
}

// audio 元素分支:纯音频容器
const AUDIO_MIME_FALLBACKS: Record<string, string[]> = {
  ".mp3": ["audio/mpeg"],
  ".m4a": ["audio/mp4", "audio/x-m4a", "audio/aac"],
  ".wav": ["audio/wav", "audio/wave", "audio/x-wav"],
  ".ogg": ["audio/ogg"],
  ".aac": ["audio/aac", "audio/mp4"],
  ".flac": ["audio/flac", "audio/x-flac"],
  ".opus": ["audio/opus", "audio/ogg"],
}

// video 元素分支
const VIDEO_MIME_FALLBACKS: Record<string, string[]> = {
  ".mp4": ["video/mp4"],
  ".m4v": ["video/mp4"],
  ".mov": ["video/quicktime", "video/mp4"],
  ".webm": ["video/webm"],
  ".mkv": ["video/x-matroska", "video/mp4"],
  ".avi": ["video/x-msvideo", "video/avi"],
}

// FORK: 图片预览 — 走 localasset 不进 JS 内存,同时修原"图片不可预览"缺位
// [feat: large-file-preview-guard] 2026-05-21
const IMAGE_MIME_FALLBACKS: Record<string, string[]> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".bmp": ["image/bmp"],
  ".svg": ["image/svg+xml"],
  ".ico": ["image/x-icon"],
}

// WebView2 内置播放器解不出的扩展(实测:audio 元素和 video 元素都失败)。直接走"用系统播放器打开"兜底,跳过 base64 加载。
const UNSUPPORTED_MEDIA_EXTS = new Set([".m4a"])

function isUnsupportedMedia(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  for (const ext of UNSUPPORTED_MEDIA_EXTS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

// FORK: image kind 加入,统一走 localasset 渲染 [feat: large-file-preview-guard] 2026-05-21
type MediaKind = "audio" | "video" | "image"

function mediaKindFromPath(p: string | undefined): { kind: MediaKind; mimes: string[] } | null {
  if (!p) return null
  const lower = p.toLowerCase()
  for (const ext in VIDEO_MIME_FALLBACKS) {
    if (lower.endsWith(ext)) return { kind: "video", mimes: VIDEO_MIME_FALLBACKS[ext] }
  }
  for (const ext in AUDIO_MIME_FALLBACKS) {
    if (lower.endsWith(ext)) return { kind: "audio", mimes: AUDIO_MIME_FALLBACKS[ext] }
  }
  for (const ext in IMAGE_MIME_FALLBACKS) {
    if (lower.endsWith(ext)) return { kind: "image", mimes: IMAGE_MIME_FALLBACKS[ext] }
  }
  return null
}

// FORK: pdf-like 检测(PDF + Office) — ContextMenuHost data-slot 条件性 wrap 用
// 用 wrapper 替代直接改 packages/ui/.../pdf.tsx(后者在 R4 黑名单)。等价效果。
// [feat: office-选中加聊天] 2026-05-24
function isPdfLikePath(p: string | undefined): boolean {
  if (!p) return false
  return p.toLowerCase().endsWith(".pdf") || isOfficeDocument(p)
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

export function FileTabContent(props: {
  tab: string
  // FORK: MD 内链跳转 [link](./other.md) — 点击在文件查看器打开目标 2026-05-05
  onOpenTab?: (path: string) => void
}) {
  const file = useFile()
  const sdk = useSDK()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  // FORK: .md 导出 PDF / Word — 走 platform.saveFilePickerDialog [feat: md-export-pdf-word] 2026-05-05
  const platform = usePlatform()
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
  // FORK: md-editing-iter-2 — 编辑器光标 / 选区状态(行/列/选中字符数)2026-05-09
  const [cursorInfo, setCursorInfo] = createSignal<CursorInfo | undefined>(undefined)
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
    if (isOfficeDocument(p)) return false
    // FORK: 大文件预览统一防护 — tooLarge 文件 contents 已空,必须用 state.tooLarge 短路防止编辑空内容覆盖真实文件
    // [feat: large-file-preview-guard] 2026-05-21
    if (state()?.tooLarge) return false
    if (tooLarge(contents())) return false
    return true
  }
  const editDisabledReason = () => {
    if (!isTauri()) return "Edit only available in desktop app"
    const p = path()
    if (!p) return undefined
    if (isOfficeDocument(p)) return "Office 文件暂不支持在 OpenCode 内编辑，请用本机软件打开"
    if (isBinary(p)) return "Binary file cannot be edited"
    // FORK: 大文件预览统一防护 [feat: large-file-preview-guard] 2026-05-21
    if (state()?.tooLarge) return "文件过大,编辑已禁用"
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
  // FORK: saveEdit 重构为 saveEditCore({ silent }) — auto-save 用 silent 路径:
  //   - silent=true(auto-save):成功不 toast,失败仍 toast;mtime 冲突不弹 confirm
  //     (保持 editing 让 user 主动 save 时再走 confirm 流程,避免 auto-save 突然弹窗);
  //     成功后不 reloadAndExitEdit(user 还在编辑,只更新 loadedMtime 让下次 save 也能 mtime 检测)
  //   - silent=false(主动 Save 按钮):原行为不变(toast + reloadAndExitEdit + confirm)
  // [feat: auto-save-debounce-flush] 2026-05-21
  const saveEditCore = async (opts: { silent: boolean }) => {
    const p = path()
    const root = sdk.directory
    if (!p || !root || draft() === null) return
    try {
      // FORK: 标记 self-writing 短期窗口,防 watcher 误识别为外部 AI 修改弹 toast
      // [feat: auto-save-debounce-flush] 2026-05-21
      if (opts.silent) file.markSelfWriting(p)
      await performWrite(root, p, draft() ?? "", loadedMtime())
      // FORK: 保存成功后清掉残留的 dirtyConflict toast(修"保存后双提示框"bug)2026-05-05
      file.dismissDirtyConflict(p)
      if (opts.silent) {
        // auto-save:保持 editing,更新 loadedMtime 让下次 save 也能用 mtime 检测
        try {
          const newMtime = await invoke<number>("get_file_mtime", { root, path: p })
          setLoadedMtime(newMtime)
        } catch {
          setLoadedMtime(null)
        }
      } else {
        // 主动 Save:退编辑 + reload contents
        await reloadAndExitEdit(p)
        showToast({ variant: "success", title: "Saved" })
      }
    } catch (e) {
      const msg = String(e)
      if (msg.includes("mtime_conflict")) {
        if (opts.silent) {
          // FORK: auto-save 遇外部修改不弹 confirm,toast warning 让 user 主动 save 再处理
          // [feat: auto-save-debounce-flush] 2026-05-21
          showToast({
            variant: "error",
            title: "自动保存暂停 — 文件已被外部修改",
            description: "请手动点 Save 选择覆盖或重载磁盘版本",
          })
          return
        }
        const overwrite = window.confirm(
          "⚠ 磁盘上的这个文件已被其他程序修改(可能是 AI 或外部编辑器)。\n\n" +
            "[确定] 覆盖磁盘版本,保存我的改动\n" +
            "[取消] 丢弃我的改动,重新加载磁盘版本",
        )
        if (overwrite) {
          try {
            await performWrite(root, p, draft() ?? "", null)
            await reloadAndExitEdit(p)
            file.dismissDirtyConflict(p)
            showToast({ variant: "success", title: "Overwritten" })
          } catch (e2) {
            showToast({ variant: "error", title: `Overwrite failed: ${e2}` })
          }
        } else {
          await reloadAndExitEdit(p)
          file.dismissDirtyConflict(p)
          showToast({ variant: "success", title: "Reloaded from disk" })
        }
      } else if (msg.includes("readonly:")) {
        showToast({ variant: "error", title: "File is read-only, cannot save" })
      } else {
        showToast({ variant: "error", title: `Save failed: ${e}` })
      }
    }
  }
  const saveEdit = () => saveEditCore({ silent: false })

  // FORK: debounce auto-save — editing 中 draft 变化 1s 静默后自动落盘
  // [feat: auto-save-debounce-flush] 2026-05-21
  const AUTO_SAVE_DELAY_MS = 1000
  const autoSave = createDebounced(() => saveEditCore({ silent: true }), AUTO_SAVE_DELAY_MS)

  // draft 改动 + editing + dirty → trigger debounce(1s 后没新改动则 save)
  createEffect(() => {
    draft()
    if (editing() && dirty()) {
      autoSave.trigger()
    }
  })

  // editing 退出取消挂起的 autoSave(cancelEdit / saveEditCore 退编辑 / tab 切换 都会 cover)
  createEffect(
    on(editing, (now) => {
      if (!now) autoSave.cancel()
    }),
  )

  // FORK: unmount 时 flush dirty draft + cancel debounce(切 tab 真触发点)
  //   关键发现:`<Show when={activeFileTab()} keyed>`(session-side-panel.tsx)切 tab 时
  //   整个 FileTabContent unmount + remount,path signal 不会"变化",createEffect(on(path))
  //   永不 fire。flush 必须放 onCleanup,unmount 前 signal 仍可读,setStoredContent 经
  //   父级 file context 安全生效(下次 mount 看新 store 内容)。
  //   [feat: auto-save-debounce-flush] 2026-05-22
  onCleanup(() => {
    autoSave.cancel()
    const oldPath = path()
    if (editing() && dirty() && oldPath && sdk.directory) {
      const snap = draft() ?? ""
      const mtime = loadedMtime()
      const root = sdk.directory
      void (async () => {
        try {
          file.markSelfWriting(oldPath)
          await performWrite(root, oldPath, snap, mtime)
          file.dismissDirtyConflict(oldPath)
          file.setStoredContent(oldPath, snap)
        } catch (e) {
          const msg = String(e)
          if (msg.includes("mtime_conflict")) {
            showToast({
              variant: "error",
              title: "切 tab 时自动保存失败 — 文件已被外部修改",
              description: `${oldPath} 改动已丢失,原文件未变(磁盘上是外部最新版本)`,
            })
          } else if (msg.includes("readonly:")) {
            showToast({ variant: "error", title: `${oldPath} 是只读文件,自动保存失败` })
          } else {
            showToast({ variant: "error", title: `${oldPath} 自动保存失败:${e}` })
          }
        }
      })()
    }
  })

  // FORK: window close flush — 监听 Tauri prevent_close 之前发的 "flush-before-close" event
  // [feat: auto-save-debounce-flush] 2026-05-21
  onMount(() => {
    const handler = () => {
      if (editing() && dirty()) {
        autoSave.flush()
      }
    }
    window.addEventListener("deskfox-flush-now", handler)
    onCleanup(() => window.removeEventListener("deskfox-flush-now", handler))
  })
  // FORK: dirty 状态同步给 file context,让 watcher reload 守卫(查看器-自动刷新)2026-04-28
  createEffect(
    on(
      () => ({ p: path(), d: dirty() }),
      (curr, prev) => {
        if (prev?.p && prev.p !== curr.p) {
          file.markDirty(prev.p, false)
        }
        if (curr.p) file.markDirty(curr.p, curr.d)
      },
    ),
  )
  onCleanup(() => {
    const p = path()
    if (p) file.markDirty(p, false)
  })
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
    origin?: "review" | "file" | "quote"
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
      // FORK: 编辑态聚焦 CodeMirror 时让编辑器自己收 Ctrl+F(@codemirror/search 面板)2026-05-05
      const active = document.activeElement as HTMLElement | null
      if (active?.closest(".cm-editor")) return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  // FORK-BEGIN: 文件查看器 Ctrl/Cmd+C — 修非 .md 内容(@pierre/diffs shadow DOM)原生 Ctrl+C 拿不到选区的 bug 2026-05-04
  // 现象:.md 走 light DOM 原生 Ctrl+C 工作;代码 / HTML / PDF / office 预览走 <diffs-container> shadow DOM,
  // window.getSelection().toString() 对 shadow 内容返回空 → 系统剪贴板拿不到东西 → "Ctrl+C 没反应"。
  // 解法:复用既有 pickBestRecentSelection()(2026-04-29 macOS 选区修复时建立的 shadow-aware 历史栈),
  // 加 window-capture keydown,Ctrl/Cmd+C 时把"最近最长"选区文本 writeText 到剪贴板,preventDefault 阻断原生
  // 的失败路径。.md 也命中(无回归 — light DOM 选区也进 history),编辑态 / input / textarea / contenteditable 时让原生走。
  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "c") return
      if (editing()) return // CodeMirror 编辑态自己管 Ctrl+C

      // 焦点在可编辑元素 → 让原生处理(input/textarea 自有 selection,不走 history)
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae.isContentEditable)) return

      const best = pickBestRecentSelection()
      if (!best || !best.text.trim()) return // 无可用选区 → 让原生处理(也是 no-op)

      event.preventDefault()
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(best.text).catch(() => {})
      }
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })
  // FORK-END

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

  // 选区红色覆盖层:绝对定位的 div 数组,通过 range.getClientRects() 计算每行 rect。
  //
  // 之前用 CSS Custom Highlight API(::highlight pseudo + CSS.highlights 注册表)实测在
  // macOS WKWebView 上 delete 注册项**不能立即触发 repaint**(WebKit 的 stale 渲染 bug),
  // 即便先 set 一个 collapsed 空 range 兜底也压不住 —— 用户点"加入聊天"或点空白处关菜单后,
  // 红色高亮死活不消失,只能刷新页面才清。
  //
  // 改用 overlay div 方案:
  //   - 显示:range.getClientRects() 拿每行 viewport rect → 渲染 fixed 定位的红色 div
  //   - 清除:setHighlightRects(null) → Solid 信号驱动 unmount,WebKit 没机会缓存
  //   - 滚动:绑 scroll capture 监听,滚动时直接清(用户在菜单生命周期内极少滚)
  //
  // 颜色:Microsoft Fluent 系统红 #d13438 半透明 0.5 alpha,与 Windows 同款操作色一致。
  // md / 代码文件 / Pierre shadow DOM 都走同一渲染路径,视觉天然一致。
  type HighlightRect = { left: number; top: number; width: number; height: number }
  const [highlightRects, setHighlightRects] = createSignal<HighlightRect[] | null>(null)

  const setSelectionHighlight = (range: Range | null) => {
    if (!range) {
      setHighlightRects(null)
      return
    }
    try {
      const rects = Array.from(range.getClientRects())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
      setHighlightRects(rects.length > 0 ? rects : null)
    } catch {
      setHighlightRects(null)
    }
  }

  // 滚动时清掉(viewport rect 会失效);菜单生命周期短,滚动概率低
  createEffect(() => {
    if (!highlightRects()) return
    const onScroll = () => setHighlightRects(null)
    window.addEventListener("scroll", onScroll, true)
    onCleanup(() => window.removeEventListener("scroll", onScroll, true))
  })

  const closeMdMenu = () => {
    setMdMenu((m) => (m.open ? { ...m, open: false } : m))
    setMdComment("")
    setSelectionHighlight(null)
    // 关闭右键菜单时一并清掉:① 原生 window selection(字符级蓝/黄高亮)
    // ② Pierre 的 selectedLines(整行黄色色块)。无论用户是"加入聊天"还是"取消",
    // 选区视觉都同步消失,菜单关闭后页面回到无选区干净态。
    if (typeof window !== "undefined") {
      try {
        window.getSelection()?.removeAllRanges()
      } catch {
        // ignore
      }
    }
    setNote("selected", null)
    const p = path()
    if (p) file.setSelectedLines(p, null)
  }

  // FORK-BEGIN: macOS WebKit Shadow DOM 选区修复 2026-04-29
  // 问题 1:WebKit 不支持 ShadowRoot.getSelection(),window.getSelection().toString()
  // 对 Shadow DOM 内容返回空串 → 用 getComposedRanges({ shadowRoots }) API(WebKit 17+)读取。
  //
  // 问题 2:macOS WebKit 右键点击文字时 OS 级强制 collapse 选区到右键点中的那个词,
  // 任何 JS 层 preventDefault 都拦不住,且 collapse 后的 selectionchange 时机不定
  // (可能在 mousedown JS handler 之前或之后)。
  //
  // 第三轮 pop+block 方案的失败原因:用户刚选完就右键时,最后一条历史栈条目正是
  // 用户真实选区(<100ms 新),被 pop 掉 → 栈空 → fallback 读 collapse 后的词。
  // 空白处右键能成功是侥幸(WebKit 不 collapse 空白),一碰文字就破。
  //
  // 第四轮解法:**最近窗口内挑最长** —— WebKit collapse 出的单词必然比用户多行选区短。
  //   1) selectionchange 不加任何屏蔽,所有非空选区都进历史栈(限 16 条)
  //   2) 不在 mousedown 时 pop(那是错的)
  //   3) contextmenu 时:从最近 30 秒的历史里挑文本最长的那条 → 必为用户真实选区
  //   4) 程序化恢复 window.getSelection() + CSS Custom Highlight(0.55 alpha 强色)双重视觉
  type SelSnapshot = { text: string; range: Range; shadow: ShadowRoot | null; time: number }
  const selectionHistory: SelSnapshot[] = []
  const SEL_HISTORY_LIMIT = 16
  const SEL_HISTORY_RECENT_MS = 30_000
  const knownShadows = new Set<ShadowRoot>()

  // 收集 Shadow Root(从 mouse 事件 composedPath + DOM 查询双通道)
  const handlePreContextCapture = (event: MouseEvent) => {
    const composedPath = typeof event.composedPath === "function" ? event.composedPath() : []
    for (const node of composedPath) {
      if (node instanceof ShadowRoot) { knownShadows.add(node); break }
    }
    // 备用:直接查找 Pierre 的 diffs-container shadow root
    const target = event.currentTarget as HTMLElement | null
    if (target) {
      const host = target.querySelector("diffs-container")
      const sr = host?.shadowRoot
      if (sr) knownShadows.add(sr)
    }
  }

  // 从 Selection 对象读取文本(支持 Shadow DOM 跨边界选区)
  const readSelectionText = (sel: Selection): { text: string; range: Range | null; shadow: ShadowRoot | null } => {
    // 策略 1:getComposedRanges({ shadowRoots }) — WebKit 17+ 跨 shadow 选区 API
    // API 签名:options object 形式(与 Pierre file-selection.ts 一致)
    if (knownShadows.size > 0 && typeof (sel as any).getComposedRanges === "function") {
      try {
        const shadowArray = [...knownShadows]
        const staticRanges = (sel as any).getComposedRanges({ shadowRoots: shadowArray }) as StaticRange[]
        if (staticRanges?.length > 0) {
          const sr = staticRanges[0]
          const r = document.createRange()
          r.setStart(sr.startContainer, sr.startOffset)
          r.setEnd(sr.endContainer, sr.endOffset)
          // 文本提取:toString() 优先,cloneContents().textContent 备用
          const t = r.toString() || r.cloneContents()?.textContent || ""
          if (t.trim()) {
            const root = sr.startContainer.getRootNode()
            return { text: t, range: r, shadow: root instanceof ShadowRoot ? root : null }
          }
        }
      } catch {
        // ignore
      }
    }

    // 策略 2:ShadowRoot.getSelection (Chromium 专有)
    for (const sh of knownShadows) {
      try {
        const shadowSel = (sh as unknown as { getSelection?: () => Selection | null }).getSelection?.()
        if (shadowSel && shadowSel.toString().trim()) {
          return {
            text: shadowSel.toString(),
            range: shadowSel.rangeCount > 0 ? shadowSel.getRangeAt(0).cloneRange() : null,
            shadow: sh,
          }
        }
      } catch {
        // ignore
      }
    }

    // 策略 3:window.getSelection (light DOM / md 文件)
    const t = sel.toString()
    if (t.trim() && sel.rangeCount > 0) {
      return { text: t, range: sel.getRangeAt(0).cloneRange(), shadow: null }
    }

    return { text: "", range: null, shadow: null }
  }

  // selectionchange:无脑记录所有非空选区到历史栈(不屏蔽、不 pop)。
  // 之所以不需要屏蔽 collapse 回调:contextmenu 阶段挑"最近窗口里最长的那条"足以排除短的 collapse 词。
  onMount(() => {
    const onSelChange = () => {
      const sel = typeof window !== "undefined" ? window.getSelection() : null
      if (!sel) return
      const result = readSelectionText(sel)
      if (!result.text.trim() || !result.range) return
      selectionHistory.push({
        text: result.text,
        range: result.range,
        shadow: result.shadow,
        time: Date.now(),
      })
      if (selectionHistory.length > SEL_HISTORY_LIMIT) selectionHistory.shift()
    }
    document.addEventListener("selectionchange", onSelChange)
    onCleanup(() => document.removeEventListener("selectionchange", onSelChange))
  })

  // 从最近 30 秒历史里挑"文本最长"的快照:WebKit collapse 出的单词永远比用户多行选区短。
  const pickBestRecentSelection = (): SelSnapshot | null => {
    if (selectionHistory.length === 0) return null
    const now = Date.now()
    let best: SelSnapshot | null = null
    for (let i = selectionHistory.length - 1; i >= 0; i--) {
      const s = selectionHistory[i]!
      if (now - s.time > SEL_HISTORY_RECENT_MS) break
      if (!best || s.text.length > best.text.length) best = s
    }
    return best
  }
  // FORK-END

  const handleSelectionContextMenu = (event: MouseEvent) => {
    if (editing()) return // 编辑态让 CodeMirror 拿到原生右键菜单
    event.preventDefault()

    // 从 composedPath 找 shadow root 并收集
    let shadow: ShadowRoot | null = null
    const composedPath = typeof event.composedPath === "function" ? event.composedPath() : []
    for (const node of composedPath) {
      if (node instanceof ShadowRoot) { shadow = node; knownShadows.add(shadow); break }
    }

    // 主路径:历史栈里最近 30 秒"文本最长"的条目 → 必为用户多行真实选区
    // (collapse 出的单词肯定更短)。
    let text = ""
    let range: Range | null = null

    const best = pickBestRecentSelection()
    if (best) {
      text = best.text
      range = best.range
      shadow = best.shadow ?? shadow
    } else {
      // 回退:历史完全空(用户首次右键、或刚切换文件)→ 读当前选区
      const sel = typeof window !== "undefined" ? window.getSelection() : null
      if (sel) {
        const result = readSelectionText(sel)
        text = result.text
        range = result.range
        shadow = result.shadow ?? shadow
      }
    }

    if (text.trim() && range) {
      setSelectionHighlight(range)

      // 程序化恢复原生选区:让 OS 绘制的蓝/黄高亮重新覆盖到原始范围。
      // 跨 Shadow DOM 时 addRange 可能静默失败,overlay div 兜底视觉。
      try {
        const sel = typeof window !== "undefined" ? window.getSelection() : null
        if (sel) {
          sel.removeAllRanges()
          sel.addRange(range.cloneRange())
        }
      } catch {
        // ignore — 恢复失败也不影响菜单功能
      }
    }

    setMdComment("")
    setMdMenu({ open: true, x: event.clientX, y: event.clientY, text, mode: "menu" })
  }

  // FORK: light DOM 右键菜单 — 直接读浏览器原生选区,不走历史栈。 2026-05-06
  // 历史栈机制(pickBestRecentSelection)原本只为对抗 Pierre Shadow DOM 在 WebKit 上的
  // selection collapse(右键瞬间选区被 OS 强制 collapse 成单词)。light DOM(.md 自渲染)
  // 上浏览器自己保选区,栈反而引入两个 bug:
  //   ① 选完文字 → 点空白 → 别处右键 → 旧选区从栈里复活,菜单命中旧选区
  //   ② 连选两段 → 别处右键 → 算法挑"最长那条"而非最近,命中第一段不是第二段
  // light DOM 不需要历史栈,直接读 window.getSelection() 即可。
  const handleLightDomContextMenu = (event: MouseEvent) => {
    if (editing()) return
    event.preventDefault()

    let text = ""
    let range: Range | null = null
    const sel = typeof window !== "undefined" ? window.getSelection() : null
    if (sel && sel.rangeCount > 0) {
      const t = sel.toString()
      if (t.trim()) {
        text = t
        range = sel.getRangeAt(0).cloneRange()
      }
    }

    if (text.trim() && range) {
      setSelectionHighlight(range)
    } else {
      setSelectionHighlight(null)
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

  // FORK-BEGIN: .md 导出 Word [feat: md-export-pdf-word] 2026-05-05
  const onExportDocx = async () => {
    closeMdMenu()
    const p = path()
    const text = contents()
    if (!p || !text) return
    const saveDialog = platform.saveFilePickerDialog
    if (!saveDialog) {
      // 非 desktop 平台 / 平台未实现 — 不应该到这,viewer 只在 desktop 用
      showToast({ variant: "error", title: language.t("fileViewer.toast.exportDocxFail") })
      return
    }
    // 默认文件名 = 原 .md 文件名(去 .md/.markdown 后缀)
    const baseName =
      p.replace(/\\/g, "/").split("/").pop()?.replace(/\.(md|markdown)$/i, "") || "untitled"
    // mdFileDir = .md 文件所在目录绝对路径(同 mdAssetRewriter 计算逻辑),
    // 让 helper 把 ![](./img.png) 等本地图替换为 base64 dataURL 嵌入 docx
    const root = sdk.directory
    const mdFileDir = root && p ? pathDirname(`${root}/${p}`.replace(/\\/g, "/")) : undefined

    await exportMdAsDocx({
      markdownText: text,
      defaultFileName: baseName,
      saveDialog,
      viewerEl: mdContainerRef(),
      mdFileDir,
      i18n: {
        title: language.t("fileViewer.dialog.exportDocxTitle"),
        success: language.t("fileViewer.toast.exportDocxSuccess"),
        fail: language.t("fileViewer.toast.exportDocxFail"),
      },
    })
  }
  // FORK-END

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
    // FORK: 加 attachment 后把焦点 + 光标交还 chat input,user 可立刻继续打字 [feat: chat-input-focus-follow] 2026-05-21
    // rAF 跟 chat-selection-menu / applyHistoryPrompt 同套路,等 attachment 卡片插入触发的 layout 完再 focus
    requestAnimationFrame(focusChatInput)
    // 注:closeMdMenu 已统一处理 removeAllRanges + 清 Pierre 行选区
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

  // FORK: html-viewer-ux-polish 2026-05-14 — iframe 内事件桥接
  // Rust handler 给 HTML 响应注 capture-phase listener:
  //   - contextmenu: 翻译坐标后弹自家 mdMenu(与 .md 右键体验一致)
  //   - mousedown:   若 mdMenu 当前 open,左键点 iframe 内任意处自动关菜单(对齐 light DOM 的点空白消失行为)
  onMount(() => {
    if (typeof window === "undefined") return
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== "object") return
      if ((data as { __deskfox?: unknown }).__deskfox !== true) return
      const t = (data as { type?: unknown }).type
      if (t === "contextmenu") {
        if (!isHtmlPath(path())) return
        const iframe = document.querySelector('iframe[data-html-preview="true"]') as HTMLIFrameElement | null
        if (!iframe) return
        const rect = iframe.getBoundingClientRect()
        const x = rect.left + (Number((data as { x?: unknown }).x) || 0)
        const y = rect.top + (Number((data as { y?: unknown }).y) || 0)
        const txt = (data as { text?: unknown }).text
        const text = typeof txt === "string" ? txt : ""
        setMdComment("")
        setMdMenu({ open: true, x, y, text, mode: "menu" })
      } else if (t === "mousedown") {
        if (mdMenu().open) closeMdMenu()
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  // FORK: 给 <Markdown> 注入本地资源 src 重写(.md 同目录/相对目录 <img>/<video>/<audio> 走 localasset:// 而非 404)2026-05-05
  // baseDir = 当前 .md 文件所在目录的绝对路径(sdk.directory + dirname(path()));聊天侧不传 rewriteAssetSrc 钩子,无回归
  const mdAssetRewriter = createMemo(() => {
    const root = sdk.directory
    const p = path()
    if (!root || !p) return undefined
    const fileAbs = `${root}/${p}`.replace(/\\/g, "/")
    const baseDir = pathDirname(fileAbs)
    if (!baseDir) return undefined
    return (src: string) => rewriteAssetSrc(root, baseDir, src)
  })

  // FORK: MD 内链点击拦截 — 用容器 ref 监听点击事件(2026-05-05 P0 fix:移除 TOC,user 不要大纲面板)
  const [mdContainerRef, setMdContainerRef] = createSignal<HTMLDivElement | undefined>()

  // MD 内链点击拦截:相对路径 *.md / *.txt / 等 → 调 props.onOpenTab 在查看器打开
  const handleMdLinkClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest("a") as HTMLAnchorElement | null
    if (!link) return
    const href = link.getAttribute("href")
    if (!href) return
    // 跳过外链 / data / blob / 锚点;锚点(#xxx)留给浏览器原生处理
    if (/^(https?|mailto|data|blob|tauri|localasset|file|javascript):/i.test(href)) return
    if (href.startsWith("//")) return
    if (href.startsWith("#")) return

    const root = sdk.directory
    const p = path()
    if (!root || !p) return

    const fileAbs = `${root}/${p}`.replace(/\\/g, "/")
    const baseDir = pathDirname(fileAbs)
    const targetAbs = resolveAbsolute(baseDir, href)

    const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "")
    // 越权防护:解析后必须在 sdk.directory 内
    if (!targetAbs.startsWith(normRoot + "/") && targetAbs !== normRoot) {
      showToast({ variant: "error", title: "链接超出项目范围", description: targetAbs })
      event.preventDefault()
      return
    }

    const rel = targetAbs.startsWith(normRoot + "/") ? targetAbs.slice(normRoot.length + 1) : ""
    if (rel && props.onOpenTab) {
      // 永远 preventDefault — 防 Tauri 把 _blank 路由到系统浏览器
      event.preventDefault()
      // 异步检查文件存在;不存在 → toast 提示,不开 tab
      const onOpen = props.onOpenTab
      invoke<number>("get_file_mtime", { root, path: rel })
        .then(() => onOpen(rel))
        .catch(() => {
          showToast({ variant: "error", title: "文件不存在", description: rel })
        })
    } else {
      // 没拿到合法相对路径(可能是绝对路径或 root 外)— 也阻止默认,防止开浏览器
      event.preventDefault()
    }
  }

  const renderMarkdown = (source: string) => (
    // FORK: data-context scope 让 markdown.css 单独定制文件查看器排版,不影响聊天 2026-04-29
    // FORK: stripFrontmatter — D5 Obsidian 风默认隐藏 YAML 头 2026-05-05
    // FORK: 内链点击拦截 + onClick 容器 — TOC 已移除(user 2026-05-05 反馈不需要)
    <div
      ref={setMdContainerRef}
      data-context="file-viewer"
      class="relative pb-40 px-6 py-4 select-text"
      onContextMenu={handleLightDomContextMenu}
      onClick={handleMdLinkClick}
    >
      <Markdown text={stripFrontmatter(source)} cacheKey={cacheKey()} rewriteAssetSrc={mdAssetRewriter()} />
    </div>
  )

  // FORK: 大文件预览统一防护 L2 — 媒体改走 localasset:// 不进 JS 内存,浏览器原生 HTTP Range
  // 分片读取,1GB+ 视频秒开 + 支持 seek + 内存占用恒定。
  // 不再走 read_binary_file_base64 → base64ToBlob → URL.createObjectURL 链路(OOM 根源)
  // [feat: large-file-preview-guard] 2026-05-21
  const mediaInput = createMemo<{ root: string; path: string; mimes: string[]; kind: MediaKind } | null>(() => {
    const p = path()
    if (!p) return null
    const m = mediaKindFromPath(p)
    if (!m) return null
    const root = sdk.directory
    if (!root) return null
    return { root, path: p, mimes: m.mimes, kind: m.kind }
  })

  type MediaState = {
    url: string | null
    mimes: string[]
    kind: MediaKind | null
    error: string | null
  }
  const [mediaState, setMediaState] = createSignal<MediaState>({
    url: null,
    mimes: [],
    kind: null,
    error: null,
  })

  createEffect(() => {
    const input = mediaInput()
    if (!input) {
      setMediaState({ url: null, mimes: [], kind: null, error: null })
      return
    }
    if (isUnsupportedMedia(input.path)) {
      setMediaState({
        url: null,
        mimes: input.mimes,
        kind: input.kind,
        error: "此格式 WebView2 内置播放器无法解码,请用下方按钮调系统播放器",
      })
      return
    }
    const abs = `${input.root}/${input.path}`.replace(/\\/g, "/")
    setMediaState({
      url: localAssetUrl(input.root, abs),
      mimes: input.mimes,
      kind: input.kind,
      error: null,
    })
  })

  const openMediaInSystemPlayer = async () => {
    const root = sdk.directory
    const p = path()
    if (!root || !p) return
    const absPath = `${root}/${p}`.replace(/\\/g, "/")
    try {
      await invoke("open_path", { path: absPath, appName: null })
    } catch (e) {
      showToast({ variant: "error", title: `打开失败: ${e}` })
    }
  }

  // FORK: img 没有 .error 字段(只有 HTMLMediaElement 有);union 类型容错避免 img onError 时崩
  // [feat: large-file-preview-guard] 2026-05-21
  const onMediaError = (e: { currentTarget: HTMLMediaElement | HTMLImageElement }) => {
    const target = e.currentTarget
    const codeMap: Record<number, string> = {
      1: "ABORTED",
      2: "NETWORK",
      3: "DECODE",
      4: "SRC_NOT_SUPPORTED",
    }
    let detail = "unknown"
    if (target instanceof HTMLMediaElement) {
      const err = target.error
      detail = err
        ? `code=${err.code} (${codeMap[err.code] ?? "UNKNOWN"}) msg="${err.message ?? ""}"`
        : "unknown"
    } else if (target instanceof HTMLImageElement) {
      // img 只能从 naturalWidth/Height 和 complete 推断
      detail = target.complete && target.naturalWidth === 0 ? "无法解码图片" : "加载失败"
    }
    setMediaState((s) => ({ ...s, url: null, error: `解码失败: ${detail}` }))
  }

  const renderMedia = () => (
    <div class="flex flex-col items-center justify-center px-6 py-8 gap-3">
      <Show
        when={mediaState().url}
        fallback={
          <div class="text-text-weak text-sm max-w-xl text-center break-words">
            {mediaState().error ? `加载失败:${mediaState().error}` : "无内容"}
          </div>
        }
      >
        <Switch>
          <Match when={mediaState().kind === "video"}>
            <video
              class="w-full max-w-3xl max-h-[60vh] bg-black"
              controls
              preload="metadata"
              onError={onMediaError}
            >
              <For each={mediaState().mimes}>{(t) => <source src={mediaState().url!} type={t} />}</For>
            </video>
          </Match>
          <Match when={mediaState().kind === "audio"}>
            <audio class="w-full max-w-xl" controls preload="metadata" onError={onMediaError}>
              <For each={mediaState().mimes}>{(t) => <source src={mediaState().url!} type={t} />}</For>
            </audio>
          </Match>
          {/* FORK: 图片预览 — 走 localasset,跟 video/audio 同套路 [feat: large-file-preview-guard] 2026-05-21 */}
          <Match when={mediaState().kind === "image"}>
            <img
              src={mediaState().url!}
              class="max-w-full max-h-[80vh] object-contain"
              alt={path() ?? ""}
              onError={onMediaError}
            />
          </Match>
        </Switch>
      </Show>
      <div class="text-xs text-text-weak truncate max-w-full" title={mediaState().mimes.join(", ")}>
        {path()}
      </div>
      <button
        type="button"
        onClick={openMediaInSystemPlayer}
        class="text-xs px-3 py-1.5 rounded border border-border-base hover:bg-surface-base-hover"
        title="若内置播放器/解码器不支持(WebView2 codec 受限或编码不兼容),点这里用系统默认应用打开"
      >
        用本机软件打开
      </button>
    </div>
  )

  // FORK: 默认渲染路径(@pierre/diffs / fileComponent)— 提取成独立 helper 以便 HTML 源码视图复用 2026-05-05
  //
  // FORK: PDF/office 文件外层加 data-slot="pdf-viewer" wrap,让 ContextMenuHost 识别预览区
  // 接管右键(capture 阶段 preventDefault,mdMenu 走 bubble 不会触发)。
  // wrap 用 display:contents 不影响布局。[feat: office-选中加聊天] 2026-05-24
  const renderDefault = (source: string) => {
    const inner = (
    <div class="relative overflow-hidden pb-40" onMouseDown={handlePreContextCapture} onContextMenu={handleSelectionContextMenu}>
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
          onError: (args: { kind: "image" | "audio" | "svg" | "pdf" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
          officeTooling: {
            getStatus: async () =>
              sdk.client.office.tooling
                .status()
                .then((x) => x.data as any)
                .catch(() => undefined),
            startInstall: async () =>
              sdk.client.office.tooling
                .install()
                .then((x) => x.data as any)
                .catch(() => undefined),
            getProgress: async () =>
              sdk.client.office.tooling
                .progress()
                .then((x) => x.data as any)
                .catch(() => undefined),
          },
          onRetryFile: () => {
            const p = path()
            if (p) void file.load(p, { force: true })
          },
          onOpenExternal: () => {
            const root = sdk.directory
            const p = path()
            if (!root || !p) return
            const absPath = `${root}/${p}`.replace(/\\/g, "/")
            invoke("open_path", { path: absPath, appName: null }).catch((e) => {
              showToast({
                variant: "error",
                title: "无法用本机软件打开",
                description: String(e),
              })
            })
          },
          loadOfficePdf: async (filePath: string) => {
            const cacheKey = `${sdk.directory ?? ""}::${filePath}`
            const cached = officePdfCacheGet(cacheKey)
            if (cached) return cached
            try {
              const res = await sdk.client.file.officePdf(
                { path: filePath },
                { parseAs: "arrayBuffer" } as any,
              )
              const data = (res as any)?.data
              let bytes: Uint8Array | undefined
              if (data instanceof ArrayBuffer) bytes = new Uint8Array(data)
              else if (data instanceof Uint8Array) bytes = data
              else if (data && (data as any).byteLength != null)
                bytes = new Uint8Array(data as ArrayBufferLike)
              if (bytes && bytes.length > 0) {
                officePdfCacheSet(cacheKey, bytes)
              }
              return bytes
            } catch (e) {
              console.warn("loadOfficePdf failed", e)
              return undefined
            }
          },
        }}
      />
    </div>
    )
    if (isPdfLikePath(path())) {
      // FORK: PDF/office 顶栏常驻"用本机软件打开"按钮 — soffice 转的 PDF 是只读栅格化输出,
      // 公式/图表/艺术字光栅化后选不到。给"我就要编辑原始格式"的 user 永久兜底入口。
      //
      // FORK: select-text 必加 — root layout.tsx 全局 `select-none` 只白名单 input/textarea/contenteditable;
      // PDF.js textLayer 的 spans 是普通 <span> 继承 select-none → 文字无法选中。在 wrap 这层
      // 重新启用 user-select:text,CSS 继承传到 .pdf-page-wrapper → .textLayer → span。
      // 跟 message-part.css:709-710 chat 区开 user-select:text 同套路。
      // [feat: office-选中加聊天] 2026-05-24 hot-fix(user 实测 textLayer 选不中复现)
      return (
        <div data-slot="pdf-viewer" data-file-path={path() ?? ""} class="flex flex-col h-full select-text">
          <div class="flex items-center justify-end gap-2 px-3 py-1 border-b border-border-base bg-surface-raised-stronger-non-alpha text-xs">
            <button
              type="button"
              onClick={() => {
                const root = sdk.directory
                const p = path()
                if (!root || !p) return
                const absPath = `${root}/${p}`.replace(/\\/g, "/")
                invoke("open_path", { path: absPath, appName: null }).catch((e) => {
                  showToast({
                    variant: "error",
                    title: "无法用本机软件打开",
                    description: String(e),
                  })
                })
              }}
              class="px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
              title="用系统默认应用打开此文件(Word / Excel / PowerPoint / PDF Reader)"
            >
              用本机软件打开
            </button>
          </div>
          <div class="flex-1 min-h-0 overflow-hidden">{inner}</div>
        </div>
      )
    }
    return inner
  }

  // FORK: HTML 预览 — iframe 占满,无顶部 toolbar;右键 → 编辑 进 CodeMirror html 源码模式
  // sandbox: allow-same-origin + allow-scripts(parent 跨 origin,MDN 警告不适用,详 html-viewer-allow-scripts)
  // iframe 内的相对资源(./img.png 等)走 localasset:// 自然解析
  // 大文件(>10MB)走 placeholder(预览 + 编辑同卡,渲染源码也无意义)
  // FORK: 2026-05-14 去顶部 toolbar(预览/源码 toggle 删除)+ 阈值 2MB→10MB + 右键菜单接入 [feat: html-viewer-ux-polish]
  const renderHtml = (source: string) => {
    const root = sdk.directory
    const p = path()
    const sourceLen = source?.length ?? 0
    const tooLargeForPreview = sourceLen > HTML_PREVIEW_MAX_BYTES
    const previewUrl = root && p ? localAssetUrl(root, `${root}/${p}`) : ""

    if (tooLargeForPreview) {
      return (
        <div
          class="relative flex flex-col h-full items-center justify-center px-6 py-8 text-center"
          onContextMenu={handleLightDomContextMenu}
        >
          <div class="text-text-base text-sm">文件 &gt;10MB,不支持预览/编辑</div>
          <div class="text-text-weak text-xs mt-2">请用本机软件打开</div>
        </div>
      )
    }

    return (
      <div class="relative flex flex-col h-full overflow-hidden" onContextMenu={handleLightDomContextMenu}>
        <Show when={previewUrl} fallback={renderDefault(source)}>
          <iframe
            data-html-preview="true"
            src={previewUrl}
            sandbox="allow-same-origin allow-scripts"
            referrerpolicy="no-referrer"
            class="w-full flex-1 bg-white border-0"
            style={{ "min-height": "60vh" }}
          />
        </Show>
      </div>
    )
  }

  const renderFile = (source: string) => {
    const p = path()
    // FORK: 大文件预览统一防护 — L1 闸门已在 context/file.tsx load() 命中,UI 渲染 FileTooLarge
    // [feat: large-file-preview-guard] 2026-05-21
    const tooLarge = state()?.tooLarge
    if (tooLarge && p) {
      return (
        <FileTooLarge
          path={p}
          root={sdk.directory ?? ""}
          size={tooLarge.size}
          category={tooLarge.category}
          limit={tooLarge.limit}
        />
      )
    }
    if (isMarkdownPath(p)) return renderMarkdown(source)
    if (mediaKindFromPath(p)) return renderMedia()
    if (isHtmlPath(p)) return renderHtml(source)
    return renderDefault(source)
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
            {/* FORK: 去掉 overflow-hidden — 否则 cm-panels-top 的 position: sticky 会绑到本 wrapper(它不滚),
                导致搜索面板被外层 ScrollView 一起滚走;让 sticky 链路穿过此 wrapper 直达 ScrollView 视口 2026-05-05 */}
            <div class="relative p-2" style={{ "min-height": "300px" }}>
              <CodeMirrorView
                value={contents()}
                language={langFromExt(path() ?? "")}
                onChange={setDraft}
                // FORK: md-editing-iter-2 — 光标 / 选区状态上报状态栏 2026-05-09
                onCursorChange={setCursorInfo}
                // FORK: .md 文件编辑态注入 markdown 增强扩展 — 列表续延 / 拖图 / Ctrl+F 等 2026-05-05
                extraExtensions={
                  isMarkdownPath(path())
                    ? markdownEditorExtensions({
                        projectRoot: sdk.directory,
                        filePathRel: path() ?? undefined,
                        locale: language.locale(),
                      })
                    : undefined
                }
              />
              {/* FORK: md-editing-iter-2 — 编辑态状态栏 2026-05-09 */}
              <CmStatusBar info={cursorInfo()} />
            </div>
          </Match>
          <Match when={state()?.loaded}>{renderFile(contents())}</Match>
          <Match when={state()?.loading}>
            <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
          </Match>
          <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
        </Switch>
      </ScrollView>
      <Show when={highlightRects()}>
        <Portal mount={document.body}>
          <For each={highlightRects()!}>
            {(rect) => (
              <div
                class="fixed pointer-events-none z-40"
                style={{
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                  "background-color": "rgba(209, 52, 56, 0.5)",
                }}
              />
            )}
          </For>
        </Portal>
      </Show>
      <Show when={mdMenu().open}>
        <Portal mount={document.body}>
          <Switch>
            <Match when={mdMenu().mode === "menu"}>
              <div
                data-slot="md-selection-menu"
                class="fixed z-50 min-w-[220px] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] py-1 text-sm"
                style={{ left: `${mdMenu().x}px`, top: `${mdMenu().y}px` }}
              >
                {/* FORK: 始终显示完整菜单(2026-05-07)— 选区相关项(添加到聊天 / 复制)按
                    mdMenu().text.trim() disabled 灰显;编辑 / 导出 Word 不依赖选区,始终可用。
                    UX 一致性:user 一眼看到全部能做的事,不用先选文字才知道有"导出 Word"。
                    [feat: menu-always-show-with-disabled] */}
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!mdMenu().text.trim()}
                  onClick={openMdInputPanel}
                >
                  {language.t("fileViewer.menu.addToChat")}
                </button>
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!canEdit() || !state()?.loaded}
                  title={editDisabledReason()}
                  onClick={startEditFromMenu}
                >
                  {language.t("common.edit")}
                </button>
                <div class="my-1 border-t border-border-base" />
                <button
                  class="w-full px-3 py-1.5 hover:bg-surface-base-hover flex justify-between items-center gap-6 disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!mdMenu().text.trim()}
                  onClick={copyMdSelection}
                >
                  <span>{language.t("fileViewer.menu.copy")}</span>
                  <span class="text-xs text-text-weak">Ctrl+C</span>
                </button>
                <div class="my-1 border-t border-border-base" />
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!isMarkdownPath(path())}
                  title={isMarkdownPath(path()) ? undefined : language.t("fileViewer.menu.exportDocxOnlyMd")}
                  onClick={() => void onExportDocx()}
                >
                  {language.t("fileViewer.menu.exportDocx")}
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
                  placeholder={language.t("fileViewer.menu.input.placeholder")}
                  value={mdComment()}
                  onInput={(e) => setMdComment(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return
                    // FORK: macOS 加 Option+Enter 提交,Win/Linux 维持 Ctrl+Enter,Mac 维持 Cmd+Enter 2026-04-30
                    if (!(e.ctrlKey || e.metaKey || (IS_MAC && e.altKey))) return
                    e.preventDefault()
                    submitMdSelection()
                  }}
                />
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-text-weak">
                    {language.t("fileViewer.menu.input.shortcutHint", {
                      shortcut: IS_MAC ? "Cmd/Opt+Enter" : "Ctrl+Enter",
                    })}
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      class="text-xs px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
                      onClick={closeMdMenu}
                    >
                      {language.t("common.cancel")}
                    </button>
                    <button
                      class="text-xs px-2 py-1 rounded border border-border-base bg-surface-base hover:bg-surface-base-hover"
                      onClick={submitMdSelection}
                    >
                      {language.t("fileViewer.menu.input.submit")}
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
