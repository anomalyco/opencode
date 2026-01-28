import {
  For,
  onCleanup,
  onMount,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  createSignal,
  on,
  type JSX,
} from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Dynamic } from "solid-js/web"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { createStore } from "solid-js/store"
import { PromptInput } from "@/components/prompt-input"
import { SessionContextUsage } from "@/components/session-context-usage"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useCodeComponent } from "@opencode-ai/ui/context/code"
import { LineComment as LineCommentView, LineCommentEditor } from "@opencode-ai/ui/line-comment"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { BasicTool } from "@opencode-ai/ui/basic-tool"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { Mark } from "@opencode-ai/ui/logo"

import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useSync } from "@/context/sync"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLayout } from "@/context/layout"
import { Terminal } from "@/components/terminal"
import { checksum, base64Encode } from "@opencode-ai/util/encode"
import { findLast } from "@opencode-ai/util/array"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectFile } from "@/components/dialog-select-file"
import FileTree from "@/components/file-tree"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { DialogFork } from "@/components/dialog-fork"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useNavigate, useParams } from "@solidjs/router"
import { UserMessage } from "@opencode-ai/sdk/v2"
import type { FileDiff } from "@opencode-ai/sdk/v2/client"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { useComments, type LineComment } from "@/context/comments"
import { extractPromptFromParts } from "@/utils/prompt"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { usePermission } from "@/context/permission"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import {
  SessionHeader,
  SessionContextTab,
  SortableTab,
  FileVisual,
  SortableTerminalTab,
  NewSessionView,
} from "@/components/session"
import { navMark, navParams } from "@/utils/perf"
import { same } from "@/utils/same"

type DiffStyle = "unified" | "split"

const handoff = {
  prompt: "",
  terminals: [] as string[],
  files: {} as Record<string, SelectedLineRange | null>,
}

interface SessionReviewTabProps {
  diffs: () => FileDiff[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  diffStyle: DiffStyle
  onDiffStyleChange?: (style: DiffStyle) => void
  onViewFile?: (file: string) => void
  onLineComment?: (comment: { file: string; selection: SelectedLineRange; comment: string; preview?: string }) => void
  comments?: LineComment[]
  focusedComment?: { file: string; id: string } | null
  onFocusedCommentChange?: (focus: { file: string; id: string } | null) => void
  focusedFile?: string
  onScrollRef?: (el: HTMLDivElement) => void
  classes?: {
    root?: string
    header?: string
    container?: string
  }
}

function StickyAddButton(props: { children: JSX.Element }) {
  const [stuck, setStuck] = createSignal(false)
  let button: HTMLDivElement | undefined

  createEffect(() => {
    const node = button
    if (!node) return

    const scroll = node.parentElement
    if (!scroll) return

    const handler = () => {
      const rect = node.getBoundingClientRect()
      const scrollRect = scroll.getBoundingClientRect()
      setStuck(rect.right >= scrollRect.right && scroll.scrollWidth > scroll.clientWidth)
    }

    scroll.addEventListener("scroll", handler, { passive: true })
    const observer = new ResizeObserver(handler)
    observer.observe(scroll)
    handler()
    onCleanup(() => {
      scroll.removeEventListener("scroll", handler)
      observer.disconnect()
    })
  })

  return (
    <div
      ref={button}
      class="bg-background-base h-full shrink-0 sticky right-0 z-10 flex items-center justify-center border-b border-border-weak-base px-3"
      classList={{ "border-l": stuck() }}
    >
      {props.children}
    </div>
  )
}

function SessionReviewTab(props: SessionReviewTabProps) {
  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const sdk = useSDK()

  const readFile = async (path: string) => {
    return sdk.client.file
      .read({ path })
      .then((x) => x.data)
      .catch(() => undefined)
  }

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = props.view().scroll("review")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      props.view().setScroll("review", next)
    })
  }

  createEffect(
    on(
      () => props.diffs().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <SessionReview
      scrollRef={(el) => {
        scroll = el
        props.onScrollRef?.(el)
        restoreScroll()
      }}
      onScroll={handleScroll}
      onDiffRendered={() => requestAnimationFrame(restoreScroll)}
      open={props.view().review.open()}
      onOpenChange={props.view().review.setOpen}
      classes={{
        root: props.classes?.root ?? "pb-40",
        header: props.classes?.header ?? "px-6",
        container: props.classes?.container ?? "px-6",
      }}
      diffs={props.diffs()}
      diffStyle={props.diffStyle}
      onDiffStyleChange={props.onDiffStyleChange}
      onViewFile={props.onViewFile}
      focusedFile={props.focusedFile}
      readFile={readFile}
      onLineComment={props.onLineComment}
      comments={props.comments}
      focusedComment={props.focusedComment}
      onFocusedCommentChange={props.onFocusedCommentChange}
    />
  )
}

export default function Page() {
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const terminal = useTerminal()
  const dialog = useDialog()
  const codeComponent = useCodeComponent()
  const command = useCommand()
  const language = useLanguage()
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const prompt = usePrompt()
  const comments = useComments()
  const permission = usePermission()

  const request = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return
    const next = sync.data.permission[sessionID]?.[0]
    if (!next) return
    if (next.tool) return
    return next
  })

  const [ui, setUi] = createStore({
    responding: false,
    pendingMessage: undefined as string | undefined,
    scrollGesture: 0,
    autoCreated: false,
  })

  createEffect(
    on(
      () => request()?.id,
      () => setUi("responding", false),
      { defer: true },
    ),
  )

  const decide = (response: "once" | "always" | "reject") => {
    const perm = request()
    if (!perm) return
    if (ui.responding) return

    setUi("responding", true)
    sdk.client.permission
      .respond({ sessionID: perm.sessionID, permissionID: perm.id, response })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setUi("responding", false))
  }
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))

  if (import.meta.env.DEV) {
    createEffect(
      on(
        () => [params.dir, params.id] as const,
        ([dir, id], prev) => {
          if (!id) return
          navParams({ dir, from: prev?.[1], to: id })
        },
      ),
    )

    createEffect(() => {
      const id = params.id
      if (!id) return
      if (!prompt.ready()) return
      navMark({ dir: params.dir, to: id, name: "storage:prompt-ready" })
    })

    createEffect(() => {
      const id = params.id
      if (!id) return
      if (!terminal.ready()) return
      navMark({ dir: params.dir, to: id, name: "storage:terminal-ready" })
    })

    createEffect(() => {
      const id = params.id
      if (!id) return
      if (!file.ready()) return
      navMark({ dir: params.dir, to: id, name: "storage:file-view-ready" })
    })

    createEffect(() => {
      const id = params.id
      if (!id) return
      if (sync.data.message[id] === undefined) return
      navMark({ dir: params.dir, to: id, name: "session:data-ready" })
    })
  }

  const isDesktop = createMediaQuery("(min-width: 768px)")

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  function normalizeTabs(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const openTab = (value: string) => {
    const next = normalizeTab(value)
    tabs().open(next)

    const path = file.pathFromTab(next)
    if (path) file.load(path)
  }

  createEffect(() => {
    const active = tabs().active()
    if (!active) return

    const path = file.pathFromTab(active)
    if (path) file.load(path)
  })

  createEffect(() => {
    const current = tabs().all()
    if (current.length === 0) return

    const next = normalizeTabs(current)
    if (same(current, next)) return

    tabs().setAll(next)

    const active = tabs().active()
    if (!active) return
    if (!active.startsWith("file://")) return

    const normalized = normalizeTab(active)
    if (active === normalized) return
    tabs().setActive(normalized)
  })

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const reviewCount = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const hasReview = createMemo(() => reviewCount() > 0)
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const messagesReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    return sync.data.message[id] !== undefined
  })
  const historyMore = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.more(id)
  })
  const historyLoading = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.loading(id)
  })
  const emptyUserMessages: UserMessage[] = []
  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )
  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        if (msg.agent) local.agent.set(msg.agent)
        if (msg.model) local.model.set(msg.model)
      },
    ),
  )

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
    activeTerminalDraggable: undefined as string | undefined,
    expanded: {} as Record<string, boolean>,
    messageId: undefined as string | undefined,
    turnStart: 0,
    mobileTab: "session" as "session" | "changes",
    newSessionWorktree: "main",
    promptHeight: 0,
  })

  const renderedUserMessages = createMemo(
    () => {
      const msgs = visibleUserMessages()
      const start = store.turnStart
      if (start <= 0) return msgs
      if (start >= msgs.length) return emptyUserMessages
      return msgs.slice(start)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync.project
    if (project && sync.data.path.directory !== project.worktree) return sync.data.path.directory
    return "main"
  })

  const activeMessage = createMemo(() => {
    if (!store.messageId) return lastUserMessage()
    const found = visibleUserMessages()?.find((m) => m.id === store.messageId)
    return found ?? lastUserMessage()
  })
  const setActiveMessage = (message: UserMessage | undefined) => {
    setStore("messageId", message?.id)
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = activeMessage()
    const currentIndex = current ? msgs.findIndex((m) => m.id === current.id) : -1
    const targetIndex = currentIndex === -1 ? (offset > 0 ? 0 : msgs.length - 1) : currentIndex + offset
    if (targetIndex < 0 || targetIndex >= msgs.length) return

    if (targetIndex === msgs.length - 1) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalize(diff.file)
      const add = diff.additions > 0
      const del = diff.deletions > 0
      const kind = add && del ? "mix" : add ? "add" : del ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })
  const emptyDiffFiles: string[] = []
  const diffFiles = createMemo(() => diffs().map((d) => d.file), emptyDiffFiles, { equals: same })
  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasReview()) return true
    return sync.data.session_diff[id] !== undefined
  })

  const idle = { type: "idle" as const }
  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined

  const scrollGestureWindowMs = 250

  let touchGesture: number | undefined

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    setUi("scrollGesture", Date.now())
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < scrollGestureWindowMs

  createEffect(() => {
    if (!params.id) return
    sync.session.sync(params.id)
  })

  createEffect(() => {
    if (!view().terminal.opened()) {
      setUi("autoCreated", false)
      return
    }
    if (!terminal.ready() || terminal.all().length !== 0 || ui.autoCreated) return
    terminal.new()
    setUi("autoCreated", true)
  })

  createEffect(
    on(
      () => terminal.all().length,
      (count, prevCount) => {
        if (prevCount !== undefined && prevCount > 0 && count === 0) {
          if (view().terminal.opened()) {
            view().terminal.toggle()
          }
        }
      },
    ),
  )

  createEffect(
    on(
      () => terminal.active(),
      (activeId) => {
        if (!activeId || !view().terminal.opened()) return
        // Immediately remove focus
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        const wrapper = document.getElementById(`terminal-wrapper-${activeId}`)
        const element = wrapper?.querySelector('[data-component="terminal"]') as HTMLElement
        if (!element) return

        // Find and focus the ghostty textarea (the actual input element)
        const textarea = element.querySelector("textarea") as HTMLTextAreaElement
        if (textarea) {
          textarea.focus()
          return
        }
        // Fallback: focus container and dispatch pointer event
        element.focus()
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
      },
    ),
  )

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          setStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  const status = createMemo(() => sync.data.session_status[params.id ?? ""] ?? idle)

  createEffect(
    on(
      () => params.id,
      () => {
        setStore("messageId", undefined)
        setStore("expanded", {})
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const id = lastUserMessage()?.id
    if (!id) return
    setStore("expanded", id, status().type !== "idle")
  })

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    const start = Math.max(1, Math.min(selection.startLine, selection.endLine))
    const end = Math.max(selection.startLine, selection.endLine)
    const lines = content.split("\n").slice(start - 1, end)
    if (lines.length === 0) return undefined
    return lines.slice(0, 2).join("\n")
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? selectionPreview(input.file, selection)
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

  command.register(() => [
    {
      id: "session.new",
      title: language.t("command.session.new"),
      category: language.t("command.category.session"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: () => navigate(`/${params.dir}/session`),
    },
    {
      id: "file.open",
      title: language.t("command.file.open"),
      description: language.t("command.file.open.description"),
      category: language.t("command.category.file"),
      keybind: "mod+p",
      slash: "open",
      onSelect: () => dialog.show(() => <DialogSelectFile onOpenFile={() => showAllFiles()} />),
    },
    {
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      category: language.t("command.category.context"),
      keybind: "mod+shift+l",
      disabled: (() => {
        const active = tabs().active()
        if (!active) return true
        const path = file.pathFromTab(active)
        if (!path) return true
        return file.selectedLines(path) == null
      })(),
      onSelect: () => {
        const active = tabs().active()
        if (!active) return
        const path = file.pathFromTab(active)
        if (!path) return

        const range = file.selectedLines(path)
        if (!range) {
          showToast({
            title: language.t("toast.context.noLineSelection.title"),
            description: language.t("toast.context.noLineSelection.description"),
          })
          return
        }

        addSelectionToContext(path, selectionFromLines(range))
      },
    },
    {
      id: "terminal.toggle",
      title: language.t("command.terminal.toggle"),
      description: "",
      category: language.t("command.category.view"),
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => view().terminal.toggle(),
    },
    {
      id: "fileTree.toggle",
      title: language.t("command.fileTree.toggle"),
      description: "",
      category: language.t("command.category.view"),
      keybind: "mod+shift+r",
      onSelect: () => layout.fileTree.toggle(),
    },
    {
      id: "terminal.new",
      title: language.t("command.terminal.new"),
      description: language.t("command.terminal.new.description"),
      category: language.t("command.category.terminal"),
      keybind: "ctrl+alt+t",
      onSelect: () => {
        if (terminal.all().length > 0) terminal.new()
        view().terminal.open()
      },
    },
    {
      id: "steps.toggle",
      title: language.t("command.steps.toggle"),
      description: language.t("command.steps.toggle.description"),
      category: language.t("command.category.view"),
      keybind: "mod+e",
      slash: "steps",
      disabled: !params.id,
      onSelect: () => {
        const msg = activeMessage()
        if (!msg) return
        setStore("expanded", msg.id, (open: boolean | undefined) => !open)
      },
    },
    {
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      category: language.t("command.category.session"),
      keybind: "mod+arrowup",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    },
    {
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      category: language.t("command.category.session"),
      keybind: "mod+arrowdown",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    },
    {
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      category: language.t("command.category.model"),
      keybind: "mod+'",
      slash: "model",
      onSelect: () => dialog.show(() => <DialogSelectModel />),
    },
    {
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      category: language.t("command.category.mcp"),
      keybind: "mod+;",
      slash: "mcp",
      onSelect: () => dialog.show(() => <DialogSelectMcp />),
    },
    {
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      category: language.t("command.category.agent"),
      keybind: "mod+.",
      slash: "agent",
      onSelect: () => local.agent.move(1),
    },
    {
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      category: language.t("command.category.agent"),
      keybind: "shift+mod+.",
      onSelect: () => local.agent.move(-1),
    },
    {
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      category: language.t("command.category.model"),
      keybind: "shift+mod+d",
      onSelect: () => {
        local.model.variant.cycle()
      },
    },
    {
      id: "permissions.autoaccept",
      title:
        params.id && permission.isAutoAccepting(params.id, sdk.directory)
          ? language.t("command.permissions.autoaccept.disable")
          : language.t("command.permissions.autoaccept.enable"),
      category: language.t("command.category.permissions"),
      keybind: "mod+shift+a",
      disabled: !params.id || !permission.permissionsEnabled(),
      onSelect: () => {
        const sessionID = params.id
        if (!sessionID) return
        permission.toggleAutoAccept(sessionID, sdk.directory)
        showToast({
          title: permission.isAutoAccepting(sessionID, sdk.directory)
            ? language.t("toast.permissions.autoaccept.on.title")
            : language.t("toast.permissions.autoaccept.off.title"),
          description: permission.isAutoAccepting(sessionID, sdk.directory)
            ? language.t("toast.permissions.autoaccept.on.description")
            : language.t("toast.permissions.autoaccept.off.description"),
        })
      },
    },
    {
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      category: language.t("command.category.session"),
      slash: "undo",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        if (status()?.type !== "idle") {
          await sdk.client.session.abort({ sessionID }).catch(() => {})
        }
        const revert = info()?.revert?.messageID
        // Find the last user message that's not already reverted
        const message = findLast(userMessages(), (x) => !revert || x.id < revert)
        if (!message) return
        await sdk.client.session.revert({ sessionID, messageID: message.id })
        // Restore the prompt from the reverted message
        const parts = sync.data.part[message.id]
        if (parts) {
          const restored = extractPromptFromParts(parts, { directory: sdk.directory })
          prompt.set(restored)
        }
        // Navigate to the message before the reverted one (which will be the new last visible message)
        const priorMessage = findLast(userMessages(), (x) => x.id < message.id)
        setActiveMessage(priorMessage)
      },
    },
    {
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      category: language.t("command.category.session"),
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const revertMessageID = info()?.revert?.messageID
        if (!revertMessageID) return
        const nextMessage = userMessages().find((x) => x.id > revertMessageID)
        if (!nextMessage) {
          // Full unrevert - restore all messages and navigate to last
          await sdk.client.session.unrevert({ sessionID })
          prompt.reset()
          // Navigate to the last message (the one that was at the revert point)
          const lastMsg = findLast(userMessages(), (x) => x.id >= revertMessageID)
          setActiveMessage(lastMsg)
          return
        }
        // Partial redo - move forward to next message
        await sdk.client.session.revert({ sessionID, messageID: nextMessage.id })
        // Navigate to the message before the new revert point
        const priorMsg = findLast(userMessages(), (x) => x.id < nextMessage.id)
        setActiveMessage(priorMsg)
      },
    },
    {
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      category: language.t("command.category.session"),
      slash: "compact",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const model = local.model.current()
        if (!model) {
          showToast({
            title: language.t("toast.model.none.title"),
            description: language.t("toast.model.none.description"),
          })
          return
        }
        await sdk.client.session.summarize({
          sessionID,
          modelID: model.id,
          providerID: model.provider.id,
        })
      },
    },
    {
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      category: language.t("command.category.session"),
      slash: "fork",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: () => dialog.show(() => <DialogFork />),
    },
    ...(sync.data.config.share !== "disabled"
      ? [
          {
            id: "session.share",
            title: language.t("command.session.share"),
            description: language.t("command.session.share.description"),
            category: language.t("command.category.session"),
            slash: "share",
            disabled: !params.id || !!info()?.share?.url,
            onSelect: async () => {
              if (!params.id) return
              await sdk.client.session
                .share({ sessionID: params.id })
                .then((res) => {
                  navigator.clipboard.writeText(res.data!.share!.url).catch(() =>
                    showToast({
                      title: language.t("toast.session.share.copyFailed.title"),
                      variant: "error",
                    }),
                  )
                })
                .then(() =>
                  showToast({
                    title: language.t("toast.session.share.success.title"),
                    description: language.t("toast.session.share.success.description"),
                    variant: "success",
                  }),
                )
                .catch(() =>
                  showToast({
                    title: language.t("toast.session.share.failed.title"),
                    description: language.t("toast.session.share.failed.description"),
                    variant: "error",
                  }),
                )
            },
          },
          {
            id: "session.unshare",
            title: language.t("command.session.unshare"),
            description: language.t("command.session.unshare.description"),
            category: language.t("command.category.session"),
            slash: "unshare",
            disabled: !params.id || !info()?.share?.url,
            onSelect: async () => {
              if (!params.id) return
              await sdk.client.session
                .unshare({ sessionID: params.id })
                .then(() =>
                  showToast({
                    title: language.t("toast.session.unshare.success.title"),
                    description: language.t("toast.session.unshare.success.description"),
                    variant: "success",
                  }),
                )
                .catch(() =>
                  showToast({
                    title: language.t("toast.session.unshare.failed.title"),
                    description: language.t("toast.session.unshare.failed.description"),
                    variant: "error",
                  }),
                )
            },
          },
        ]
      : []),
  ])

  const handleKeyDown = (event: KeyboardEvent) => {
    const activeElement = document.activeElement as HTMLElement | undefined
    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(activeElement.tagName) || activeElement.isContentEditable
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    // Don't autofocus chat if terminal panel is open
    if (view().terminal.opened()) return

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      markScrollGesture()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      inputRef?.focus()
    }
  }

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const currentTabs = tabs().all()
      const fromIndex = currentTabs?.indexOf(draggable.id.toString())
      const toIndex = currentTabs?.indexOf(droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== undefined) {
        tabs().move(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  const handleTerminalDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeTerminalDraggable", id)
  }

  const handleTerminalDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const terminals = terminal.all()
      const fromIndex = terminals.findIndex((t: LocalPTY) => t.id === draggable.id.toString())
      const toIndex = terminals.findIndex((t: LocalPTY) => t.id === droppable.id.toString())
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        terminal.move(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleTerminalDragEnd = () => {
    setStore("activeTerminalDraggable", undefined)
    const activeId = terminal.active()
    if (!activeId) return
    setTimeout(() => {
      const wrapper = document.getElementById(`terminal-wrapper-${activeId}`)
      const element = wrapper?.querySelector('[data-component="terminal"]') as HTMLElement
      if (!element) return

      // Find and focus the ghostty textarea (the actual input element)
      const textarea = element.querySelector("textarea") as HTMLTextAreaElement
      if (textarea) {
        textarea.focus()
        return
      }
      // Fallback: focus container and dispatch pointer event
      element.focus()
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
    }, 0)
  }

  const reviewTab = createMemo(() => isDesktop() && !layout.fileTree.opened())
  const contextOpen = createMemo(() => tabs().active() === "context" || tabs().all().includes("context"))
  const openedTabs = createMemo(() =>
    tabs()
      .all()
      .filter((tab) => tab !== "context" && tab !== "review"),
  )

  const mobileChanges = createMemo(() => !isDesktop() && store.mobileTab === "changes")

  const fileTreeTab = () => layout.fileTree.tab()
  const setFileTreeTab = (value: "changes" | "all") => layout.fileTree.setTab(value)

  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLDivElement | undefined,
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })

  const reviewScroll = () => tree.reviewScroll
  const setReviewScroll = (value: HTMLDivElement | undefined) => setTree("reviewScroll", value)
  const pendingDiff = () => tree.pendingDiff
  const setPendingDiff = (value: string | undefined) => setTree("pendingDiff", value)
  const activeDiff = () => tree.activeDiff
  const setActiveDiff = (value: string | undefined) => setTree("activeDiff", value)

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    setFileTreeTab("all")
  }

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        <Switch>
          <Match when={hasReview()}>
            <Show
              when={diffsReady()}
              fallback={<div class="px-6 py-4 text-text-weak">{language.t("session.review.loadingChanges")}</div>}
            >
              <SessionReviewTab
                diffs={diffs}
                view={view}
                diffStyle={layout.review.diffStyle()}
                onDiffStyleChange={layout.review.setDiffStyle}
                onScrollRef={setReviewScroll}
                focusedFile={activeDiff()}
                onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
                comments={comments.all()}
                focusedComment={comments.focus()}
                onFocusedCommentChange={comments.setFocus}
                onViewFile={(path) => {
                  showAllFiles()
                  const value = file.tab(path)
                  tabs().open(value)
                  file.load(path)
                }}
              />
            </Show>
          </Match>
          <Match when={true}>
            <div class="h-full px-6 pb-30 flex flex-col items-center justify-center text-center gap-6">
              <Mark class="w-14 opacity-10" />
              <div class="text-14-regular text-text-weak max-w-56">{language.t("session.review.empty")}</div>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  )

  createEffect(
    on(
      () => tabs().active(),
      (active) => {
        if (!active) return
        if (fileTreeTab() !== "changes") return
        if (!file.pathFromTab(active)) return
        showAllFiles()
      },
      { defer: true },
    ),
  )

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    setFileTreeTab(value)
  }

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = reviewScroll()
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = reviewScroll()
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    const current = view().review.open() ?? []
    if (!current.includes(path)) view().review.setOpen([...current, path])
    setActiveDiff(path)
    setPendingDiff(path)
  }

  createEffect(() => {
    const pending = pendingDiff()
    if (!pending) return
    if (!reviewScroll()) return
    if (!diffsReady()) return

    const attempt = (count: number) => {
      if (pendingDiff() !== pending) return
      if (count > 60) {
        setPendingDiff(undefined)
        return
      }

      const root = reviewScroll()
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setPendingDiff(undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  const activeTab = createMemo(() => {
    const active = tabs().active()
    if (active === "context") return "context"
    if (active === "review" && reviewTab()) return "review"
    if (active && file.pathFromTab(active)) return normalizeTab(active)

    const first = openedTabs()[0]
    if (first) return first
    if (contextOpen()) return "context"
    if (reviewTab() && hasReview()) return "review"
    return "empty"
  })

  createEffect(() => {
    if (!layout.ready()) return
    if (tabs().active()) return
    if (openedTabs().length === 0 && !contextOpen() && !(reviewTab() && hasReview())) return

    const next = activeTab()
    if (next === "empty") return
    tabs().setActive(next)
  })

  createEffect(
    on(
      () => layout.fileTree.opened(),
      (opened, prev) => {
        if (prev === undefined) return
        if (!isDesktop()) return

        if (opened) {
          const active = tabs().active()
          const tab = active === "review" || (!active && hasReview()) ? "changes" : "all"
          layout.fileTree.setTab(tab)
          return
        }

        if (fileTreeTab() !== "changes") return
        tabs().setActive("review")
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const id = params.id
    if (!id) return

    const wants = isDesktop()
      ? layout.fileTree.opened()
        ? fileTreeTab() === "changes"
        : activeTab() === "review"
      : store.mobileTab === "changes"
    if (!wants) return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return

    void sync.session.diff(id)
  })

  createEffect(() => {
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return

    fileTreeTab()
    void file.tree.list("")
  })

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  const clearMessageHash = () => {
    if (!window.location.hash) return
    window.history.replaceState(null, "", window.location.href.replace(/#.*$/, ""))
  }

  const resumeScroll = () => {
    setStore("messageId", undefined)
    autoScroll.forceScrollToBottom()
    clearMessageHash()
  }

  // When the user returns to the bottom, treat the active message as "latest".
  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        setStore("messageId", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )

  let scrollSpyFrame: number | undefined
  let scrollSpyTarget: HTMLDivElement | undefined

  const anchor = (id: string) => `message-${id}`

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
  }

  const turnInit = 20
  const turnBatch = 20
  let turnHandle: number | undefined
  let turnIdle = false

  function cancelTurnBackfill() {
    const handle = turnHandle
    if (handle === undefined) return
    turnHandle = undefined

    if (turnIdle && window.cancelIdleCallback) {
      window.cancelIdleCallback(handle)
      return
    }

    clearTimeout(handle)
  }

  function scheduleTurnBackfill() {
    if (turnHandle !== undefined) return
    if (store.turnStart <= 0) return

    if (window.requestIdleCallback) {
      turnIdle = true
      turnHandle = window.requestIdleCallback(() => {
        turnHandle = undefined
        backfillTurns()
      })
      return
    }

    turnIdle = false
    turnHandle = window.setTimeout(() => {
      turnHandle = undefined
      backfillTurns()
    }, 0)
  }

  function backfillTurns() {
    const start = store.turnStart
    if (start <= 0) return

    const next = start - turnBatch
    const nextStart = next > 0 ? next : 0

    const el = scroller
    if (!el) {
      setStore("turnStart", nextStart)
      scheduleTurnBackfill()
      return
    }

    const beforeTop = el.scrollTop
    const beforeHeight = el.scrollHeight

    setStore("turnStart", nextStart)

    requestAnimationFrame(() => {
      const delta = el.scrollHeight - beforeHeight
      if (!delta) return
      el.scrollTop = beforeTop + delta
    })

    scheduleTurnBackfill()
  }

  createEffect(
    on(
      () => [params.id, messagesReady()] as const,
      ([id, ready]) => {
        cancelTurnBackfill()
        setStore("turnStart", 0)
        if (!id || !ready) return

        const len = visibleUserMessages().length
        const start = len > turnInit ? len - turnInit : 0
        setStore("turnStart", start)
        scheduleTurnBackfill()
      },
      { defer: true },
    ),
  )

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === store.promptHeight) return

      const el = scroller
      const stick = el ? el.scrollHeight - el.clientHeight - el.scrollTop < 10 : false

      setStore("promptHeight", next)

      if (stick && el) {
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
        })
      }
    },
  )

  const updateHash = (id: string) => {
    window.history.replaceState(null, "", `#${anchor(id)}`)
  }

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return
    const raw = sessionStorage.getItem("opencode.pendingMessage")
    if (!raw) return
    const parts = raw.split("|")
    const pendingSessionID = parts[0]
    const messageID = parts[1]
    if (!pendingSessionID || !messageID) return
    if (pendingSessionID !== sessionID) return

    sessionStorage.removeItem("opencode.pendingMessage")
    setUi("pendingMessage", messageID)
  })

  const scrollToElement = (el: HTMLElement, behavior: ScrollBehavior) => {
    const root = scroller
    if (!root) return false

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    const top = a.top - b.top + root.scrollTop
    root.scrollTo({ top, behavior })
    return true
  }

  const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
    setActiveMessage(message)

    const msgs = visibleUserMessages()
    const index = msgs.findIndex((m) => m.id === message.id)
    if (index !== -1 && index < store.turnStart) {
      setStore("turnStart", index)
      scheduleTurnBackfill()

      requestAnimationFrame(() => {
        const el = document.getElementById(anchor(message.id))
        if (!el) {
          requestAnimationFrame(() => {
            const next = document.getElementById(anchor(message.id))
            if (!next) return
            scrollToElement(next, behavior)
          })
          return
        }
        scrollToElement(el, behavior)
      })

      updateHash(message.id)
      return
    }

    const el = document.getElementById(anchor(message.id))
    if (!el) {
      updateHash(message.id)
      requestAnimationFrame(() => {
        const next = document.getElementById(anchor(message.id))
        if (!next) return
        if (!scrollToElement(next, behavior)) return
      })
      return
    }
    if (scrollToElement(el, behavior)) {
      updateHash(message.id)
      return
    }

    requestAnimationFrame(() => {
      const next = document.getElementById(anchor(message.id))
      if (!next) return
      if (!scrollToElement(next, behavior)) return
    })
    updateHash(message.id)
  }

  const applyHash = (behavior: ScrollBehavior) => {
    const hash = window.location.hash.slice(1)
    if (!hash) {
      autoScroll.forceScrollToBottom()
      return
    }

    const match = hash.match(/^message-(.+)$/)
    if (match) {
      autoScroll.pause()
      const msg = visibleUserMessages().find((m) => m.id === match[1])
      if (msg) {
        scrollToMessage(msg, behavior)
        return
      }

      // If we have a message hash but the message isn't loaded/rendered yet,
      // don't fall back to "bottom". We'll retry once messages arrive.
      return
    }

    const target = document.getElementById(hash)
    if (target) {
      autoScroll.pause()
      scrollToElement(target, behavior)
      return
    }

    autoScroll.forceScrollToBottom()
  }

  const closestMessage = (node: Element | null): HTMLElement | null => {
    if (!node) return null
    const match = node.closest?.("[data-message-id]") as HTMLElement | null
    if (match) return match
    const root = node.getRootNode?.()
    if (root instanceof ShadowRoot) return closestMessage(root.host)
    return null
  }

  const getActiveMessageId = (container: HTMLDivElement) => {
    const rect = container.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + 100))

    const hit = document.elementFromPoint(x, y)
    const host = closestMessage(hit)
    const id = host?.dataset.messageId
    if (id) return id

    // Fallback: DOM query (handles edge hit-testing cases)
    const cutoff = container.scrollTop + 100
    const nodes = container.querySelectorAll<HTMLElement>("[data-message-id]")
    let last: string | undefined

    for (const node of nodes) {
      const next = node.dataset.messageId
      if (!next) continue
      if (node.offsetTop > cutoff) break
      last = next
    }

    return last
  }

  const scheduleScrollSpy = (container: HTMLDivElement) => {
    scrollSpyTarget = container
    if (scrollSpyFrame !== undefined) return

    scrollSpyFrame = requestAnimationFrame(() => {
      scrollSpyFrame = undefined

      const target = scrollSpyTarget
      scrollSpyTarget = undefined
      if (!target) return

      const id = getActiveMessageId(target)
      if (!id) return
      if (id === store.messageId) return

      setStore("messageId", id)
    })
  }

  createEffect(() => {
    const sessionID = params.id
    const ready = messagesReady()
    if (!sessionID || !ready) return

    requestAnimationFrame(() => {
      applyHash("auto")
    })
  })

  // Retry message navigation once the target message is actually loaded.
  createEffect(() => {
    const sessionID = params.id
    const ready = messagesReady()
    if (!sessionID || !ready) return

    // dependencies
    visibleUserMessages().length
    store.turnStart

    const targetId =
      ui.pendingMessage ??
      (() => {
        const hash = window.location.hash.slice(1)
        const match = hash.match(/^message-(.+)$/)
        if (!match) return undefined
        return match[1]
      })()
    if (!targetId) return
    if (store.messageId === targetId) return

    const msg = visibleUserMessages().find((m) => m.id === targetId)
    if (!msg) return
    if (ui.pendingMessage === targetId) setUi("pendingMessage", undefined)
    autoScroll.pause()
    requestAnimationFrame(() => scrollToMessage(msg, "auto"))
  })

  createEffect(() => {
    const sessionID = params.id
    const ready = messagesReady()
    if (!sessionID || !ready) return

    const handler = () => requestAnimationFrame(() => applyHash("auto"))
    window.addEventListener("hashchange", handler)
    onCleanup(() => window.removeEventListener("hashchange", handler))
  })

  createEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  const previewPrompt = () =>
    prompt
      .current()
      .map((part) => {
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        if (part.type === "image") return `[image:${part.filename}]`
        return part.content
      })
      .join("")
      .trim()

  createEffect(() => {
    if (!prompt.ready()) return
    handoff.prompt = previewPrompt()
  })

  createEffect(() => {
    if (!terminal.ready()) return
    language.locale()

    const label = (pty: LocalPTY) => {
      const title = pty.title
      const number = pty.titleNumber
      const match = title.match(/^Terminal (\d+)$/)
      const parsed = match ? Number(match[1]) : undefined
      const isDefaultTitle = Number.isFinite(number) && number > 0 && Number.isFinite(parsed) && parsed === number

      if (title && !isDefaultTitle) return title
      if (Number.isFinite(number) && number > 0) return language.t("terminal.title.numbered", { number })
      if (title) return title
      return language.t("terminal.title")
    }

    handoff.terminals = terminal.all().map(label)
  })

  createEffect(() => {
    if (!file.ready()) return
    handoff.files = Object.fromEntries(
      tabs()
        .all()
        .flatMap((tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return []
          return [[path, file.selectedLines(path) ?? null] as const]
        }),
    )
  })

  onCleanup(() => {
    cancelTurnBackfill()
    document.removeEventListener("keydown", handleKeyDown)
    if (scrollSpyFrame !== undefined) cancelAnimationFrame(scrollSpyFrame)
  })

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
      <SessionHeader />
      <div class="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Mobile tab bar */}
        <Show when={!isDesktop() && params.id}>
          <Tabs class="h-auto">
            <Tabs.List>
              <Tabs.Trigger
                value="session"
                class="w-1/2"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "session")}
              >
                {language.t("session.tab.session")}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="changes"
                class="w-1/2 !border-r-0"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "changes")}
              >
                <Switch>
                  <Match when={hasReview()}>
                    {language.t("session.review.filesChanged", { count: reviewCount() })}
                  </Match>
                  <Match when={true}>{language.t("session.review.change.other")}</Match>
                </Switch>
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Show>

        {/* Session panel */}
        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger": true,
            "flex-1 md:flex-none pt-6 md:pt-3": true,
          }}
          style={{
            width: isDesktop() ? `${layout.session.width()}px` : "100%",
            "--prompt-height": store.promptHeight ? `${store.promptHeight}px` : undefined,
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id}>
                <Show when={activeMessage()}>
                  <Show
                    when={!mobileChanges()}
                    fallback={
                      <div class="relative h-full overflow-hidden">
                        <Switch>
                          <Match when={hasReview()}>
                            <Show
                              when={diffsReady()}
                              fallback={
                                <div class="px-4 py-4 text-text-weak">
                                  {language.t("session.review.loadingChanges")}
                                </div>
                              }
                            >
                              <SessionReviewTab
                                diffs={diffs}
                                view={view}
                                diffStyle="unified"
                                focusedFile={activeDiff()}
                                onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
                                comments={comments.all()}
                                focusedComment={comments.focus()}
                                onFocusedCommentChange={comments.setFocus}
                                onViewFile={(path) => {
                                  showAllFiles()
                                  const value = file.tab(path)
                                  tabs().open(value)
                                  file.load(path)
                                }}
                                classes={{
                                  root: "pb-[calc(var(--prompt-height,8rem)+32px)]",
                                  header: "px-4",
                                  container: "px-4",
                                }}
                              />
                            </Show>
                          </Match>
                          <Match when={true}>
                            <div class="h-full px-4 pb-30 flex flex-col items-center justify-center text-center gap-6">
                              <Mark class="w-14 opacity-10" />
                              <div class="text-14-regular text-text-weak max-w-56">
                                {language.t("session.review.empty")}
                              </div>
                            </div>
                          </Match>
                        </Switch>
                      </div>
                    }
                  >
                    <div class="relative w-full h-full min-w-0">
                      <div
                        class="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--prompt-height,8rem)+32px)] z-[60] pointer-events-none transition-all duration-200 ease-out"
                        classList={{
                          "opacity-100 translate-y-0 scale-100": autoScroll.userScrolled(),
                          "opacity-0 translate-y-2 scale-95 pointer-events-none": !autoScroll.userScrolled(),
                        }}
                      >
                        <button
                          class="pointer-events-auto size-8 flex items-center justify-center rounded-full bg-background-base border border-border-base shadow-sm text-text-base hover:bg-background-stronger transition-colors"
                          onClick={resumeScroll}
                        >
                          <Icon name="arrow-down-to-line" />
                        </button>
                      </div>
                      <div
                        ref={setScrollRef}
                        onWheel={(e) => {
                          const root = e.currentTarget
                          const target = e.target instanceof Element ? e.target : undefined
                          const nested = target?.closest("[data-scrollable]")
                          if (!nested || nested === root) {
                            markScrollGesture(root)
                            return
                          }

                          if (!(nested instanceof HTMLElement)) {
                            markScrollGesture(root)
                            return
                          }

                          const max = nested.scrollHeight - nested.clientHeight
                          if (max <= 1) {
                            markScrollGesture(root)
                            return
                          }

                          const delta =
                            e.deltaMode === 1
                              ? e.deltaY * 40
                              : e.deltaMode === 2
                                ? e.deltaY * root.clientHeight
                                : e.deltaY
                          if (!delta) return

                          if (delta < 0) {
                            if (nested.scrollTop + delta <= 0) markScrollGesture(root)
                            return
                          }

                          const remaining = max - nested.scrollTop
                          if (delta > remaining) markScrollGesture(root)
                        }}
                        onTouchStart={(e) => {
                          touchGesture = e.touches[0]?.clientY
                        }}
                        onTouchMove={(e) => {
                          const next = e.touches[0]?.clientY
                          const prev = touchGesture
                          touchGesture = next
                          if (next === undefined || prev === undefined) return

                          const delta = prev - next
                          if (!delta) return

                          const root = e.currentTarget
                          const target = e.target instanceof Element ? e.target : undefined
                          const nested = target?.closest("[data-scrollable]")
                          if (!nested || nested === root) {
                            markScrollGesture(root)
                            return
                          }

                          if (!(nested instanceof HTMLElement)) {
                            markScrollGesture(root)
                            return
                          }

                          const max = nested.scrollHeight - nested.clientHeight
                          if (max <= 1) {
                            markScrollGesture(root)
                            return
                          }

                          if (delta < 0) {
                            if (nested.scrollTop + delta <= 0) markScrollGesture(root)
                            return
                          }

                          const remaining = max - nested.scrollTop
                          if (delta > remaining) markScrollGesture(root)
                        }}
                        onTouchEnd={() => {
                          touchGesture = undefined
                        }}
                        onTouchCancel={() => {
                          touchGesture = undefined
                        }}
                        onPointerDown={(e) => {
                          if (e.target !== e.currentTarget) return
                          markScrollGesture(e.currentTarget)
                        }}
                        onScroll={(e) => {
                          if (!hasScrollGesture()) return
                          autoScroll.handleScroll()
                          markScrollGesture(e.currentTarget)
                          if (isDesktop()) scheduleScrollSpy(e.currentTarget)
                        }}
                        onClick={autoScroll.handleInteraction}
                        class="relative min-w-0 w-full h-full overflow-y-auto session-scroller"
                        style={{ "--session-title-height": info()?.title || info()?.parentID ? "40px" : "0px" }}
                      >
                        <Show when={info()?.title || info()?.parentID}>
                          <div
                            classList={{
                              "sticky top-0 z-30 bg-background-stronger": true,
                              "w-full": true,
                              "px-4 md:px-6": true,
                            }}
                          >
                            <div class="h-10 flex items-center gap-1">
                              <Show when={info()?.parentID}>
                                <IconButton
                                  tabIndex={-1}
                                  icon="arrow-left"
                                  variant="ghost"
                                  onClick={() => {
                                    navigate(`/${params.dir}/session/${info()?.parentID}`)
                                  }}
                                  aria-label={language.t("common.goBack")}
                                />
                              </Show>
                              <Show when={info()?.title}>
                                <h1 class="text-16-medium text-text-strong truncate">{info()?.title}</h1>
                              </Show>
                            </div>
                          </div>
                        </Show>

                        <div
                          ref={autoScroll.contentRef}
                          role="log"
                          class="flex flex-col gap-32 items-start justify-start w-full mt-0 pb-[calc(var(--prompt-height,8rem)+64px)] md:pb-[calc(var(--prompt-height,10rem)+64px)] transition-[margin]"
                        >
                          <Show when={store.turnStart > 0}>
                            <div class="w-full flex justify-center">
                              <Button
                                variant="ghost"
                                size="large"
                                class="text-12-medium opacity-50"
                                onClick={() => setStore("turnStart", 0)}
                              >
                                {language.t("session.messages.renderEarlier")}
                              </Button>
                            </div>
                          </Show>
                          <Show when={historyMore()}>
                            <div class="w-full flex justify-center">
                              <Button
                                variant="ghost"
                                size="large"
                                class="text-12-medium opacity-50"
                                disabled={historyLoading()}
                                onClick={() => {
                                  const id = params.id
                                  if (!id) return
                                  setStore("turnStart", 0)
                                  sync.session.history.loadMore(id)
                                }}
                              >
                                {historyLoading()
                                  ? language.t("session.messages.loadingEarlier")
                                  : language.t("session.messages.loadEarlier")}
                              </Button>
                            </div>
                          </Show>
                          <For each={renderedUserMessages()}>
                            {(message) => {
                              if (import.meta.env.DEV) {
                                onMount(() => {
                                  const id = params.id
                                  if (!id) return
                                  navMark({ dir: params.dir, to: id, name: "session:first-turn-mounted" })
                                })
                              }

                              return (
                                <div
                                  id={anchor(message.id)}
                                  data-message-id={message.id}
                                  class="min-w-0 w-full max-w-full"
                                >
                                  <SessionTurn
                                    sessionID={params.id!}
                                    messageID={message.id}
                                    lastUserMessageID={lastUserMessage()?.id}
                                    stepsExpanded={store.expanded[message.id] ?? false}
                                    onStepsExpandedToggle={() =>
                                      setStore("expanded", message.id, (open: boolean | undefined) => !open)
                                    }
                                    classes={{
                                      root: "min-w-0 w-full relative",
                                      content: "flex flex-col justify-between !overflow-visible",
                                      container: "w-full px-4 md:px-6",
                                    }}
                                  />
                                </div>
                              )
                            }}
                          </For>
                        </div>
                      </div>
                    </div>
                  </Show>
                </Show>
              </Match>
              <Match when={true}>
                <NewSessionView
                  worktree={newSessionWorktree()}
                  onWorktreeChange={(value) => {
                    if (value === "create") {
                      setStore("newSessionWorktree", value)
                      return
                    }

                    setStore("newSessionWorktree", "main")

                    const target = value === "main" ? sync.project?.worktree : value
                    if (!target) return
                    if (target === sync.data.path.directory) return
                    layout.projects.open(target)
                    navigate(`/${base64Encode(target)}/session`)
                  }}
                />
              </Match>
            </Switch>
          </div>

          {/* Prompt input */}
          <div
            ref={(el) => (promptDock = el)}
            class="absolute inset-x-0 bottom-0 pt-12 pb-4 flex flex-col justify-center items-center z-50 px-4 md:px-0 bg-gradient-to-t from-background-stronger via-background-stronger to-transparent pointer-events-none"
          >
            <div class="w-full px-4 pointer-events-auto">
              <Show when={request()} keyed>
                {(perm) => (
                  <div data-component="tool-part-wrapper" data-permission="true" class="mb-3">
                    <BasicTool
                      icon="checklist"
                      locked
                      defaultOpen
                      trigger={{
                        title: language.t("notification.permission.title"),
                        subtitle:
                          perm.permission === "doom_loop"
                            ? language.t("settings.permissions.tool.doom_loop.title")
                            : perm.permission,
                      }}
                    >
                      <Show when={perm.patterns.length > 0}>
                        <div class="flex flex-col gap-1 py-2 px-3 max-h-40 overflow-y-auto no-scrollbar">
                          <For each={perm.patterns}>
                            {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
                          </For>
                        </div>
                      </Show>
                      <Show when={perm.permission === "doom_loop"}>
                        <div class="text-12-regular text-text-weak pb-2 px-3">
                          {language.t("settings.permissions.tool.doom_loop.description")}
                        </div>
                      </Show>
                    </BasicTool>
                    <div data-component="permission-prompt">
                      <div data-slot="permission-actions">
                        <Button variant="ghost" size="small" onClick={() => decide("reject")} disabled={ui.responding}>
                          {language.t("ui.permission.deny")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => decide("always")}
                          disabled={ui.responding}
                        >
                          {language.t("ui.permission.allowAlways")}
                        </Button>
                        <Button variant="primary" size="small" onClick={() => decide("once")} disabled={ui.responding}>
                          {language.t("ui.permission.allowOnce")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Show>

              <Show
                when={prompt.ready()}
                fallback={
                  <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                    {handoff.prompt || language.t("prompt.loading")}
                  </div>
                }
              >
                <PromptInput
                  ref={(el) => {
                    inputRef = el
                  }}
                  newSessionWorktree={newSessionWorktree()}
                  onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
                  onSubmit={resumeScroll}
                />
              </Show>
            </div>
          </div>

          <Show when={isDesktop()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.session.width()}
              min={450}
              max={window.innerWidth * 0.45}
              onResize={layout.session.resize}
            />
          </Show>
        </div>

        {/* Desktop side panel - hidden on mobile */}
        <Show when={isDesktop()}>
          <aside
            id="review-panel"
            aria-label={language.t("session.panel.reviewAndFiles")}
            class="relative flex-1 min-w-0 h-full border-l border-border-weak-base flex"
          >
            <div class="flex-1 min-w-0 h-full">
              <Show
                when={layout.fileTree.opened() && fileTreeTab() === "changes"}
                fallback={
                  <DragDropProvider
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    collisionDetector={closestCenter}
                  >
                    <DragDropSensors />
                    <ConstrainDragYAxis />
                    <Tabs value={activeTab()} onChange={openTab}>
                      <div class="sticky top-0 shrink-0 flex">
                        <Tabs.List>
                          <Show when={reviewTab()}>
                            <Tabs.Trigger value="review" classes={{ button: "!pl-6" }}>
                              <div class="flex items-center gap-3">
                                <Show when={hasReview() && diffsReady()}>
                                  <DiffChanges changes={diffs()} variant="bars" />
                                </Show>
                                <div class="flex items-center gap-1.5">
                                  <div>{language.t("session.tab.review")}</div>
                                  <Show when={hasReview()}>
                                    <div class="text-12-medium text-text-strong h-4 px-2 flex flex-col items-center justify-center rounded-full bg-surface-base">
                                      {reviewCount()}
                                    </div>
                                  </Show>
                                </div>
                              </div>
                            </Tabs.Trigger>
                          </Show>
                          <Show when={contextOpen()}>
                            <Tabs.Trigger
                              value="context"
                              closeButton={
                                <Tooltip value={language.t("common.closeTab")} placement="bottom">
                                  <IconButton
                                    icon="close-small"
                                    variant="ghost"
                                    class="h-5 w-5"
                                    onClick={() => tabs().close("context")}
                                    aria-label={language.t("common.closeTab")}
                                  />
                                </Tooltip>
                              }
                              hideCloseButton
                              onMiddleClick={() => tabs().close("context")}
                            >
                              <div class="flex items-center gap-2">
                                <SessionContextUsage variant="indicator" />
                                <div>{language.t("session.tab.context")}</div>
                              </div>
                            </Tabs.Trigger>
                          </Show>
                          <SortableProvider ids={openedTabs()}>
                            <For each={openedTabs()}>
                              {(tab) => <SortableTab tab={tab} onTabClose={tabs().close} />}
                            </For>
                          </SortableProvider>
                          <StickyAddButton>
                            <TooltipKeybind
                              title={language.t("command.file.open")}
                              keybind={command.keybind("file.open")}
                              class="flex items-center"
                            >
                              <IconButton
                                icon="plus-small"
                                variant="ghost"
                                iconSize="large"
                                onClick={() =>
                                  dialog.show(() => <DialogSelectFile mode="files" onOpenFile={() => showAllFiles()} />)
                                }
                                aria-label={language.t("command.file.open")}
                              />
                            </TooltipKeybind>
                          </StickyAddButton>
                        </Tabs.List>
                      </div>

                      <Show when={reviewTab()}>
                        <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                          <Show when={activeTab() === "review"}>{reviewPanel()}</Show>
                        </Tabs.Content>
                      </Show>

                      <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                        <Show when={activeTab() === "empty"}>
                          <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                            <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center gap-6">
                              <Mark class="w-14 opacity-10" />
                              <div class="text-14-regular text-text-weak max-w-56">
                                {language.t("session.files.selectToOpen")}
                              </div>
                            </div>
                          </div>
                        </Show>
                      </Tabs.Content>

                      <Show when={contextOpen()}>
                        <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                          <Show when={activeTab() === "context"}>
                            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                              <SessionContextTab
                                messages={messages}
                                visibleUserMessages={visibleUserMessages}
                                view={view}
                                info={info}
                              />
                            </div>
                          </Show>
                        </Tabs.Content>
                      </Show>

                      <For each={openedTabs()}>
                        {(tab) => {
                          let scroll: HTMLDivElement | undefined
                          let scrollFrame: number | undefined
                          let pending: { x: number; y: number } | undefined
                          let codeScroll: HTMLElement[] = []

                          const path = createMemo(() => file.pathFromTab(tab))
                          const state = createMemo(() => {
                            const p = path()
                            if (!p) return
                            return file.get(p)
                          })
                          const contents = createMemo(() => state()?.content?.content ?? "")
                          const cacheKey = createMemo(() => checksum(contents()))
                          const isImage = createMemo(() => {
                            const c = state()?.content
                            return (
                              c?.encoding === "base64" &&
                              c?.mimeType?.startsWith("image/") &&
                              c?.mimeType !== "image/svg+xml"
                            )
                          })
                          const isSvg = createMemo(() => {
                            const c = state()?.content
                            return c?.mimeType === "image/svg+xml"
                          })
                          const svgContent = createMemo(() => {
                            if (!isSvg()) return
                            const c = state()?.content
                            if (!c) return
                            if (c.encoding !== "base64") return c.content
                            return decode64(c.content)
                          })

                          const svgDecodeFailed = createMemo(() => {
                            if (!isSvg()) return false
                            const c = state()?.content
                            if (!c) return false
                            if (c.encoding !== "base64") return false
                            return svgContent() === undefined
                          })

                          const svgToast = { shown: false }
                          createEffect(() => {
                            if (!svgDecodeFailed()) return
                            if (svgToast.shown) return
                            svgToast.shown = true
                            showToast({
                              variant: "error",
                              title: language.t("toast.file.loadFailed.title"),
                              description: "Invalid base64 content.",
                            })
                          })
                          const svgPreviewUrl = createMemo(() => {
                            if (!isSvg()) return
                            const c = state()?.content
                            if (!c) return
                            if (c.encoding === "base64") return `data:image/svg+xml;base64,${c.content}`
                            return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.content)}`
                          })
                          const imageDataUrl = createMemo(() => {
                            if (!isImage()) return
                            const c = state()?.content
                            return `data:${c?.mimeType};base64,${c?.content}`
                          })
                          const selectedLines = createMemo(() => {
                            const p = path()
                            if (!p) return null
                            if (file.ready()) return file.selectedLines(p) ?? null
                            return handoff.files[p] ?? null
                          })

                          let wrap: HTMLDivElement | undefined

                          const fileComments = createMemo(() => {
                            const p = path()
                            if (!p) return []
                            return comments.list(p)
                          })

                          const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

                          const [note, setNote] = createStore({
                            openedComment: null as string | null,
                            commenting: null as SelectedLineRange | null,
                            draft: "",
                            positions: {} as Record<string, number>,
                            draftTop: undefined as number | undefined,
                          })

                          const openedComment = () => note.openedComment
                          const setOpenedComment = (
                            value:
                              | typeof note.openedComment
                              | ((value: typeof note.openedComment) => typeof note.openedComment),
                          ) => setNote("openedComment", value)

                          const commenting = () => note.commenting
                          const setCommenting = (
                            value: typeof note.commenting | ((value: typeof note.commenting) => typeof note.commenting),
                          ) => setNote("commenting", value)

                          const draft = () => note.draft
                          const setDraft = (
                            value: typeof note.draft | ((value: typeof note.draft) => typeof note.draft),
                          ) => setNote("draft", value)

                          const positions = () => note.positions
                          const setPositions = (
                            value: typeof note.positions | ((value: typeof note.positions) => typeof note.positions),
                          ) => setNote("positions", value)

                          const draftTop = () => note.draftTop
                          const setDraftTop = (
                            value: typeof note.draftTop | ((value: typeof note.draftTop) => typeof note.draftTop),
                          ) => setNote("draftTop", value)

                          const commentLabel = (range: SelectedLineRange) => {
                            const start = Math.min(range.start, range.end)
                            const end = Math.max(range.start, range.end)
                            if (start === end) return `line ${start}`
                            return `lines ${start}-${end}`
                          }

                          const getRoot = () => {
                            const el = wrap
                            if (!el) return

                            const host = el.querySelector("diffs-container")
                            if (!(host instanceof HTMLElement)) return

                            const root = host.shadowRoot
                            if (!root) return

                            return root
                          }

                          const findMarker = (root: ShadowRoot, range: SelectedLineRange) => {
                            const line = Math.max(range.start, range.end)
                            const node = root.querySelector(`[data-line="${line}"]`)
                            if (!(node instanceof HTMLElement)) return
                            return node
                          }

                          const markerTop = (wrapper: HTMLElement, marker: HTMLElement) => {
                            const wrapperRect = wrapper.getBoundingClientRect()
                            const rect = marker.getBoundingClientRect()
                            return rect.top - wrapperRect.top + Math.max(0, (rect.height - 20) / 2)
                          }

                          const updateComments = () => {
                            const el = wrap
                            const root = getRoot()
                            if (!el || !root) {
                              setPositions({})
                              setDraftTop(undefined)
                              return
                            }

                            const next: Record<string, number> = {}
                            for (const comment of fileComments()) {
                              const marker = findMarker(root, comment.selection)
                              if (!marker) continue
                              next[comment.id] = markerTop(el, marker)
                            }

                            setPositions(next)

                            const range = commenting()
                            if (!range) {
                              setDraftTop(undefined)
                              return
                            }

                            const marker = findMarker(root, range)
                            if (!marker) {
                              setDraftTop(undefined)
                              return
                            }

                            setDraftTop(markerTop(el, marker))
                          }

                          const scheduleComments = () => {
                            requestAnimationFrame(updateComments)
                          }

                          createEffect(() => {
                            fileComments()
                            scheduleComments()
                          })

                          createEffect(() => {
                            const range = commenting()
                            scheduleComments()
                            if (!range) return
                            setDraft("")
                          })

                          createEffect(() => {
                            const focus = comments.focus()
                            const p = path()
                            if (!focus || !p) return
                            if (focus.file !== p) return
                            if (activeTab() !== tab) return

                            const target = fileComments().find((comment) => comment.id === focus.id)
                            if (!target) return

                            setOpenedComment(target.id)
                            setCommenting(null)
                            file.setSelectedLines(p, target.selection)
                            requestAnimationFrame(() => comments.clearFocus())
                          })

                          const renderCode = (source: string, wrapperClass: string) => (
                            <div
                              ref={(el) => {
                                wrap = el
                                scheduleComments()
                              }}
                              class={`relative overflow-hidden ${wrapperClass}`}
                            >
                              <Dynamic
                                component={codeComponent}
                                file={{
                                  name: path() ?? "",
                                  contents: source,
                                  cacheKey: cacheKey(),
                                }}
                                enableLineSelection
                                selectedLines={selectedLines()}
                                commentedLines={commentedLines()}
                                onRendered={() => {
                                  requestAnimationFrame(restoreScroll)
                                  requestAnimationFrame(scheduleComments)
                                }}
                                onLineSelected={(range: SelectedLineRange | null) => {
                                  const p = path()
                                  if (!p) return
                                  file.setSelectedLines(p, range)
                                  if (!range) setCommenting(null)
                                }}
                                onLineSelectionEnd={(range: SelectedLineRange | null) => {
                                  if (!range) {
                                    setCommenting(null)
                                    return
                                  }

                                  setOpenedComment(null)
                                  setCommenting(range)
                                }}
                                overflow="scroll"
                                class="select-text"
                              />
                              <For each={fileComments()}>
                                {(comment) => (
                                  <LineCommentView
                                    id={comment.id}
                                    top={positions()[comment.id]}
                                    open={openedComment() === comment.id}
                                    comment={comment.comment}
                                    selection={commentLabel(comment.selection)}
                                    onMouseEnter={() => {
                                      const p = path()
                                      if (!p) return
                                      file.setSelectedLines(p, comment.selection)
                                    }}
                                    onClick={() => {
                                      const p = path()
                                      if (!p) return
                                      setCommenting(null)
                                      setOpenedComment((current) => (current === comment.id ? null : comment.id))
                                      file.setSelectedLines(p, comment.selection)
                                    }}
                                  />
                                )}
                              </For>
                              <Show when={commenting()}>
                                {(range) => (
                                  <Show when={draftTop() !== undefined}>
                                    <LineCommentEditor
                                      top={draftTop()}
                                      value={draft()}
                                      selection={commentLabel(range())}
                                      onInput={(value) => setDraft(value)}
                                      onCancel={() => setCommenting(null)}
                                      onSubmit={(value) => {
                                        const p = path()
                                        if (!p) return
                                        addCommentToContext({
                                          file: p,
                                          selection: range(),
                                          comment: value,
                                          origin: "file",
                                        })
                                        setCommenting(null)
                                      }}
                                      onPopoverFocusOut={(e: FocusEvent) => {
                                        const current = e.currentTarget as HTMLDivElement
                                        const target = e.relatedTarget
                                        if (target instanceof Node && current.contains(target)) return

                                        setTimeout(() => {
                                          if (!document.activeElement || !current.contains(document.activeElement)) {
                                            setCommenting(null)
                                          }
                                        }, 0)
                                      }}
                                    />
                                  </Show>
                                )}
                              </Show>
                            </div>
                          )

                          const getCodeScroll = () => {
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

                          const queueScrollUpdate = (next: { x: number; y: number }) => {
                            pending = next
                            if (scrollFrame !== undefined) return

                            scrollFrame = requestAnimationFrame(() => {
                              scrollFrame = undefined

                              const next = pending
                              pending = undefined
                              if (!next) return

                              view().setScroll(tab, next)
                            })
                          }

                          const handleCodeScroll = (event: Event) => {
                            const el = scroll
                            if (!el) return

                            const target = event.currentTarget
                            if (!(target instanceof HTMLElement)) return

                            queueScrollUpdate({
                              x: target.scrollLeft,
                              y: el.scrollTop,
                            })
                          }

                          const syncCodeScroll = () => {
                            const next = getCodeScroll()
                            if (next.length === codeScroll.length && next.every((el, i) => el === codeScroll[i])) return

                            for (const item of codeScroll) {
                              item.removeEventListener("scroll", handleCodeScroll)
                            }

                            codeScroll = next

                            for (const item of codeScroll) {
                              item.addEventListener("scroll", handleCodeScroll)
                            }
                          }

                          const restoreScroll = () => {
                            const el = scroll
                            if (!el) return

                            const s = view()?.scroll(tab)
                            if (!s) return

                            syncCodeScroll()

                            if (codeScroll.length > 0) {
                              for (const item of codeScroll) {
                                if (item.scrollLeft !== s.x) item.scrollLeft = s.x
                              }
                            }

                            if (el.scrollTop !== s.y) el.scrollTop = s.y

                            if (codeScroll.length > 0) return

                            if (el.scrollLeft !== s.x) el.scrollLeft = s.x
                          }

                          const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
                            if (codeScroll.length === 0) syncCodeScroll()

                            queueScrollUpdate({
                              x: codeScroll[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
                              y: event.currentTarget.scrollTop,
                            })
                          }

                          createEffect(
                            on(
                              () => state()?.loaded,
                              (loaded) => {
                                if (!loaded) return
                                requestAnimationFrame(restoreScroll)
                              },
                              { defer: true },
                            ),
                          )

                          createEffect(
                            on(
                              () => file.ready(),
                              (ready) => {
                                if (!ready) return
                                requestAnimationFrame(restoreScroll)
                              },
                              { defer: true },
                            ),
                          )

                          createEffect(
                            on(
                              () => tabs().active() === tab,
                              (active) => {
                                if (!active) return
                                if (!state()?.loaded) return
                                requestAnimationFrame(restoreScroll)
                              },
                            ),
                          )

                          onCleanup(() => {
                            for (const item of codeScroll) {
                              item.removeEventListener("scroll", handleCodeScroll)
                            }

                            if (scrollFrame === undefined) return
                            cancelAnimationFrame(scrollFrame)
                          })

                          return (
                            <Tabs.Content
                              value={tab}
                              class="mt-3 relative"
                              ref={(el: HTMLDivElement) => {
                                scroll = el
                                restoreScroll()
                              }}
                              onScroll={handleScroll}
                            >
                              <Switch>
                                <Match when={state()?.loaded && isImage()}>
                                  <div class="px-6 py-4 pb-40">
                                    <img
                                      src={imageDataUrl()}
                                      alt={path()}
                                      class="max-w-full"
                                      onLoad={() => requestAnimationFrame(restoreScroll)}
                                    />
                                  </div>
                                </Match>
                                <Match when={state()?.loaded && isSvg()}>
                                  <div class="flex flex-col gap-4 px-6 py-4">
                                    {renderCode(svgContent() ?? "", "")}
                                    <Show when={svgPreviewUrl()}>
                                      <div class="flex justify-center pb-40">
                                        <img src={svgPreviewUrl()} alt={path()} class="max-w-full max-h-96" />
                                      </div>
                                    </Show>
                                  </div>
                                </Match>
                                <Match when={state()?.loaded}>{renderCode(contents(), "pb-40")}</Match>
                                <Match when={state()?.loading}>
                                  <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
                                </Match>
                                <Match when={state()?.error}>
                                  {(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}
                                </Match>
                              </Switch>
                            </Tabs.Content>
                          )
                        }}
                      </For>
                    </Tabs>
                    <DragOverlay>
                      <Show when={store.activeDraggable}>
                        {(tab) => {
                          const path = createMemo(() => file.pathFromTab(tab()))
                          return (
                            <div class="relative px-6 h-12 flex items-center bg-background-stronger border-x border-border-weak-base border-b border-b-transparent">
                              <Show when={path()}>{(p) => <FileVisual active path={p()} />}</Show>
                            </div>
                          )
                        }}
                      </Show>
                    </DragOverlay>
                  </DragDropProvider>
                }
              >
                {reviewPanel()}
              </Show>
            </div>

            <Show when={layout.fileTree.opened()}>
              <div
                id="file-tree-panel"
                class="relative shrink-0 h-full"
                style={{ width: `${layout.fileTree.width()}px` }}
              >
                <div class="h-full border-l border-border-weak-base flex flex-col overflow-hidden group/filetree">
                  <Tabs
                    variant="pill"
                    value={fileTreeTab()}
                    onChange={setFileTreeTabValue}
                    class="h-full"
                    data-scope="filetree"
                  >
                    <Tabs.List>
                      <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                        {reviewCount()}{" "}
                        {language.t(reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                      </Tabs.Trigger>
                      <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                        {language.t("session.files.all")}
                      </Tabs.Trigger>
                    </Tabs.List>
                    <Tabs.Content value="changes" class="bg-background-base px-3 py-0">
                      <Switch>
                        <Match when={hasReview()}>
                          <Show
                            when={diffsReady()}
                            fallback={
                              <div class="px-2 py-2 text-12-regular text-text-weak">
                                {language.t("common.loading")}
                                {language.t("common.loading.ellipsis")}
                              </div>
                            }
                          >
                            <FileTree
                              path=""
                              allowed={diffFiles()}
                              kinds={kinds()}
                              draggable={false}
                              active={activeDiff()}
                              onFileClick={(node) => focusReviewDiff(node.path)}
                            />
                          </Show>
                        </Match>
                        <Match when={true}>
                          <div class="mt-8 text-center text-12-regular text-text-weak">
                            {language.t("session.review.noChanges")}
                          </div>
                        </Match>
                      </Switch>
                    </Tabs.Content>
                    <Tabs.Content value="all" class="bg-background-base px-3 py-0">
                      <FileTree
                        path=""
                        modified={diffFiles()}
                        kinds={kinds()}
                        onFileClick={(node) => openTab(file.tab(node.path))}
                      />
                    </Tabs.Content>
                  </Tabs>
                </div>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={layout.fileTree.width()}
                  min={200}
                  max={480}
                  collapseThreshold={160}
                  onResize={layout.fileTree.resize}
                  onCollapse={layout.fileTree.close}
                />
              </div>
            </Show>
          </aside>
        </Show>
      </div>

      <Show when={isDesktop() && view().terminal.opened()}>
        <div
          id="terminal-panel"
          role="region"
          aria-label={language.t("terminal.title")}
          class="relative w-full flex flex-col shrink-0 border-t border-border-weak-base"
          style={{ height: `${layout.terminal.height()}px` }}
        >
          <ResizeHandle
            direction="vertical"
            size={layout.terminal.height()}
            min={100}
            max={window.innerHeight * 0.6}
            collapseThreshold={50}
            onResize={layout.terminal.resize}
            onCollapse={view().terminal.close}
          />
          <Show
            when={terminal.ready()}
            fallback={
              <div class="flex flex-col h-full pointer-events-none">
                <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weak-base bg-background-stronger overflow-hidden">
                  <For each={handoff.terminals}>
                    {(title) => (
                      <div class="px-2 py-1 rounded-md bg-surface-base text-14-regular text-text-weak truncate max-w-40">
                        {title}
                      </div>
                    )}
                  </For>
                  <div class="flex-1" />
                  <div class="text-text-weak pr-2">
                    {language.t("common.loading")}
                    {language.t("common.loading.ellipsis")}
                  </div>
                </div>
                <div class="flex-1 flex items-center justify-center text-text-weak">
                  {language.t("terminal.loading")}
                </div>
              </div>
            }
          >
            <DragDropProvider
              onDragStart={handleTerminalDragStart}
              onDragEnd={handleTerminalDragEnd}
              onDragOver={handleTerminalDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragYAxis />
              <div class="flex flex-col h-full">
                <Tabs
                  variant="alt"
                  value={terminal.active()}
                  onChange={(id) => {
                    // Only switch tabs if not in the middle of starting edit mode
                    terminal.open(id)
                  }}
                  class="!h-auto !flex-none"
                >
                  <Tabs.List class="h-10">
                    <SortableProvider ids={terminal.all().map((t: LocalPTY) => t.id)}>
                      <For each={terminal.all()}>
                        {(pty) => (
                          <SortableTerminalTab
                            terminal={pty}
                            onClose={() => {
                              view().terminal.close()
                              setUi("autoCreated", false)
                            }}
                          />
                        )}
                      </For>
                    </SortableProvider>
                    <div class="h-full flex items-center justify-center">
                      <TooltipKeybind
                        title={language.t("command.terminal.new")}
                        keybind={command.keybind("terminal.new")}
                        class="flex items-center"
                      >
                        <IconButton
                          icon="plus-small"
                          variant="ghost"
                          iconSize="large"
                          onClick={terminal.new}
                          aria-label={language.t("command.terminal.new")}
                        />
                      </TooltipKeybind>
                    </div>
                  </Tabs.List>
                </Tabs>
                <div class="flex-1 min-h-0 relative">
                  <For each={terminal.all()}>
                    {(pty) => (
                      <div
                        id={`terminal-wrapper-${pty.id}`}
                        class="absolute inset-0"
                        style={{
                          display: terminal.active() === pty.id ? "block" : "none",
                        }}
                      >
                        <Show when={pty.id} keyed>
                          <Terminal
                            pty={pty}
                            onCleanup={terminal.update}
                            onConnectError={() => terminal.clone(pty.id)}
                          />
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <DragOverlay>
                <Show when={store.activeTerminalDraggable}>
                  {(draggedId) => {
                    const pty = createMemo(() => terminal.all().find((t: LocalPTY) => t.id === draggedId()))
                    return (
                      <Show when={pty()}>
                        {(t) => (
                          <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                            {(() => {
                              const title = t().title
                              const number = t().titleNumber
                              const match = title.match(/^Terminal (\d+)$/)
                              const parsed = match ? Number(match[1]) : undefined
                              const isDefaultTitle =
                                Number.isFinite(number) && number > 0 && Number.isFinite(parsed) && parsed === number

                              if (title && !isDefaultTitle) return title
                              if (Number.isFinite(number) && number > 0)
                                return language.t("terminal.title.numbered", { number })
                              if (title) return title
                              return language.t("terminal.title")
                            })()}
                          </div>
                        )}
                      </Show>
                    )
                  }}
                </Show>
              </DragOverlay>
            </DragDropProvider>
          </Show>
        </div>
      </Show>
    </div>
  )
}
