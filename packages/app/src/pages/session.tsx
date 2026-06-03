import type { SnapshotFileDiff as FileDiff, Project, UserMessage } from "@opencode-ai/sdk/v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import {
  batch,
  onCleanup,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  createComputed,
  on,
  onMount,
  untrack,
} from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { createStore } from "solid-js/store"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Select } from "@opencode-ai/ui/select"
import { Tabs } from "@opencode-ai/ui/tabs"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode, checksum } from "@opencode-ai/core/util/encode"
import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { NewSessionView, SessionHeader } from "@/components/session"
import { useComments } from "@/context/comments"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSessionHistory } from "@/context/session-history"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import {
  clipMessages,
  createOpenReviewFile,
  createSessionTabs,
  createSizing,
  focusTerminalById,
  shouldFocusTerminalOnKeyDown,
} from "@/pages/session/helpers"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { useSessionLayout } from "@/pages/session/session-layout"
import { isExtraAgentDirectory } from "@/pages/layout/extra-agents"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { working } from "@/pages/session/session-working"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"
import { Identifier } from "@/utils/id"
import { extractPromptFromParts } from "@/utils/prompt"
import { same } from "@/utils/same"
import { formatServerError } from "@/utils/server-errors"

const emptyUserMessages: UserMessage[] = []
const scrollBottomThreshold = 16
const settleMs = 1_500
const emptyFollowups: (FollowupDraft & { id: string })[] = []
const smoothBottomSnapDistance = 900
const smoothBottomMaxStep = 180
const smoothBottomEase = 0.32

type ChangeMode = "git" | "branch" | "session" | "turn"
type VcsMode = "git" | "branch"
type ScrollMode = "live" | "anchored"

function list(value: unknown): FileDiff[] {
  // Older/local session records have previously persisted malformed `summary.diffs`
  // values. Treat anything non-array as "no diffs" so a bad record can't crash
  // the entire session view while opening review.
  return Array.isArray(value) ? value : []
}

export default function Page() {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const sdk = useSDK()
  const settings = useSettings()
  const sessionHistory = useSessionHistory()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  createEffect(() => {
    if (!untrack(() => prompt.ready())) return
    prompt.ready()
    untrack(() => {
      if (params.id || !prompt.ready()) return
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  createEffect(on(sessionKey, () => {}, { defer: true }))

  const [ui, setUi] = createStore({
    pendingMessage: undefined as string | undefined,
    seekingMessageId: undefined as string | undefined,
    reviewSnap: false,
    scrollGesture: 0,
    mode: "live" as ScrollMode,
    scroll: {
      overflow: false,
      bottom: true,
    },
  })

  const composer = createSessionComposerState()

  const workspaceKey = createMemo(() => params.dir ?? "")
  const workspaceTabs = createMemo(() => layout.tabs(workspaceKey))

  createEffect(
    on(
      () => params.id,
      (id, prev) => {
        if (!id) return
        if (prev) return

        const pending = layout.handoff.tabs()
        if (!pending) return
        if (Date.now() - pending.at > 60_000) {
          layout.handoff.clearTabs()
          return
        }

        if (pending.id !== id) return
        layout.handoff.clearTabs()
        if (pending.dir !== (params.dir ?? "")) return

        const from = workspaceTabs().tabs()
        if (from.all.length === 0 && !from.active) return

        const current = tabs().tabs()
        if (current.all.length > 0 || current.active) return

        const all = normalizeTabs(from.all)
        const active = from.active ? normalizeTab(from.active) : undefined
        tabs().setAll(all)
        tabs().setActive(active && all.includes(active) ? active : all[0])

        workspaceTabs().setAll([])
        workspaceTabs().setActive(undefined)
      },
      { defer: true },
    ),
  )

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const size = createSizing()
  const desktopReviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const desktopFileTreeOpen = createMemo(() => isDesktop() && layout.fileTree.opened())
  const desktopSidePanelOpen = createMemo(() => desktopReviewOpen() || desktopFileTreeOpen())
  const sessionPanelWidth = createMemo(() => {
    if (!desktopSidePanelOpen()) return "100%"
    if (desktopReviewOpen()) return `${layout.session.width()}px`
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const centered = createMemo(() => isDesktop() && !desktopReviewOpen())

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

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))

  // Track visited opencode sessions in a global history list so the
  // extra-agent (GenericAgent / Hermes / OpenClaw) prompt-input picker can
  // surface them later. Skip extra-agent directories — only real opencode
  // sessions belong in this list.
  createEffect(() => {
    const id = params.id
    if (!id) return
    const directory = info()?.directory
    if (!directory) return
    if (isExtraAgentDirectory(directory)) return
    const title = info()?.title ?? ""
    sessionHistory.record({ id, title, directory })
  })

  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const sessionCount = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const hasSessionReview = createMemo(() => sessionCount() > 0)
  const canReview = createMemo(() => !!params.id)
  const reviewTab = createMemo(() => isDesktop())
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: canReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const explicitMessageLimit = createMemo(() => {
    const id = params.id
    if (!id) return
    return sync.session.history.limit(id)
  })
  const messages = createMemo(() => {
    const id = params.id
    if (!id) return []
    const all = sync.data.message[id] ?? []
    const limit = explicitMessageLimit()
    return clipMessages(all, limit)
  })
  const messagesReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    const ready = sync.data.message[id] !== undefined
    console.warn(`[flash-debug] messagesReady: id=${id} ready=${ready} time=${performance.now().toFixed(1)}`)
    return ready
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
  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasSessionReview()) return true
    return sync.data.session_diff[id] !== undefined
  })

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

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (path) file.load(path)
  })

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      (next, prev) => {
        if (!prev) return
        if (next.dir === prev.dir && next.id === prev.id) return
        if (prev.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    mobileTab: "session" as "session" | "changes",
    changes: "git" as ChangeMode,
    newSessionWorktree: "main",
    newSessionPicked: false,
  })

  const [vcs, setVcs] = createStore({
    diff: {
      git: [] as FileDiff[],
      branch: [] as FileDiff[],
    },
    ready: {
      git: false,
      branch: false,
    },
  })

  const [followup, setFollowup] = createStore({
    items: {} as Record<string, (FollowupDraft & { id: string })[] | undefined>,
    failed: {} as Record<string, string | undefined>,
    paused: {} as Record<string, boolean | undefined>,
    edit: {} as Record<
      string,
      { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] } | undefined
    >,
  })

  let root: HTMLDivElement | undefined
  let reviewFrame: number | undefined
  let refreshFrame: number | undefined
  let refreshTimer: number | undefined
  let diffFrame: number | undefined
  let diffTimer: number | undefined
  const vcsTask = new Map<VcsMode, Promise<void>>()
  const vcsRun = new Map<VcsMode, number>()

  const bumpVcs = (mode: VcsMode) => {
    const next = (vcsRun.get(mode) ?? 0) + 1
    vcsRun.set(mode, next)
    return next
  }

  const resetVcs = (mode?: VcsMode) => {
    const list = mode ? [mode] : (["git", "branch"] as const)
    list.forEach((item) => {
      bumpVcs(item)
      vcsTask.delete(item)
      setVcs("diff", item, [])
      setVcs("ready", item, false)
    })
  }

  const loadVcs = (mode: VcsMode, force = false) => {
    if (sync.project?.vcs !== "git") return Promise.resolve()
    if (!force && vcs.ready[mode]) return Promise.resolve()

    if (force) {
      if (vcsTask.has(mode)) bumpVcs(mode)
      vcsTask.delete(mode)
      setVcs("ready", mode, false)
    }

    const current = vcsTask.get(mode)
    if (current) return current

    const run = bumpVcs(mode)

    const task = sdk.client.vcs
      .diff({ mode })
      .then((result) => {
        if (vcsRun.get(mode) !== run) return
        setVcs("diff", mode, result.data ?? [])
        setVcs("ready", mode, true)
      })
      .catch((error) => {
        if (vcsRun.get(mode) !== run) return
        setVcs("diff", mode, [])
        setVcs("ready", mode, true)
      })
      .finally(() => {
        if (vcsTask.get(mode) === task) vcsTask.delete(mode)
      })

    vcsTask.set(mode, task)
    return task
  }

  const refreshVcs = () => {
    resetVcs()
    const mode = untrack(vcsMode)
    if (!mode) return
    if (!untrack(wantsReview)) return
    void loadVcs(mode, true)
  }

  createComputed((prev) => {
    const open = desktopReviewOpen()
    if (prev === undefined || prev === open) return open

    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    setUi("reviewSnap", true)
    reviewFrame = requestAnimationFrame(() => {
      reviewFrame = undefined
      setUi("reviewSnap", false)
    })
    return open
  }, desktopReviewOpen())

  const turnDiffs = createMemo(() => list(lastUserMessage()?.summary?.diffs))
  const changesOptions = createMemo<ChangeMode[]>(() => {
    const list: ChangeMode[] = []
    if (sync.project?.vcs === "git") list.push("git")
    if (
      sync.project?.vcs === "git" &&
      sync.data.vcs?.branch &&
      sync.data.vcs?.default_branch &&
      sync.data.vcs.branch !== sync.data.vcs.default_branch
    ) {
      list.push("branch")
    }
    list.push("session", "turn")
    return list
  })
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    if (store.changes === "git" || store.changes === "branch") return store.changes
  })
  const reviewDiffs = createMemo(() => {
    if (store.changes === "git") return vcs.diff.git
    if (store.changes === "branch") return vcs.diff.branch
    if (store.changes === "session") return diffs()
    return turnDiffs()
  })
  const reviewCount = createMemo(() => {
    if (store.changes === "git") return vcs.diff.git.length
    if (store.changes === "branch") return vcs.diff.branch.length
    if (store.changes === "session") return sessionCount()
    return turnDiffs().length
  })
  const hasReview = createMemo(() => reviewCount() > 0)
  const reviewReady = createMemo(() => {
    if (store.changes === "git") return vcs.ready.git
    if (store.changes === "branch") return vcs.ready.branch
    if (store.changes === "session") return !hasSessionReview() || diffsReady()
    return true
  })

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    if (store.newSessionPicked) return store.newSessionWorktree
    const project = sync.project
    const directory = sdk.directory
    if (project && directory && directory.trim() !== "" && directory !== project.worktree) {
      return directory
    }
    return "main"
  })

  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    setStore("messageId", message?.id)
  }

  const anchor = (id: string) => `message-${id}`

  const cursor = () => {
    const root = scroller
    if (!root) return store.messageId

    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const list = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((el) => {
        const id = el.dataset.messageId
        if (!id) return

        const rect = el.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id

    const near = [...shown].sort((a, b) => {
      const da = Math.abs(a.top - line)
      const db = Math.abs(b.top - line)
      if (da !== db) return da - db
      return a.top - b.top
    })[0]
    if (near) return near.id

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? store.messageId
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = store.messageId && messageMark === scrollMark ? store.messageId : cursor()
    const base = current ? msgs.findIndex((m) => m.id === current) : msgs.length
    const currentIndex = base === -1 ? msgs.length : base
    const targetIndex = currentIndex + offset
    console.debug(
      `[session] message offset navigation: offset=${offset} current=${current || "none"} currentIndex=${currentIndex} targetIndex=${targetIndex} total=${msgs.length}`,
    )
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  const sessionEmptyKey = createMemo(() => {
    const project = sync.project
    if (project && !project.vcs) return "session.review.noVcs"
    if (sync.data.config.snapshot === false) return "session.review.noSnapshot"
    return "session.review.empty"
  })

  function upsert(next: Project) {
    const list = globalSync.data.project
    sync.set("project", next.id)
    const idx = list.findIndex((item) => item.id === next.id)
    if (idx >= 0) {
      globalSync.set(
        "project",
        list.map((item, i) => (i === idx ? { ...item, ...next } : item)),
      )
      return
    }
    const at = list.findIndex((item) => item.id > next.id)
    if (at >= 0) {
      globalSync.set("project", [...list.slice(0, at), next, ...list.slice(at)])
      return
    }
    globalSync.set("project", [...list, next])
  }

  const gitMutation = useMutation(() => ({
    mutationFn: () => sdk.client.project.initGit(),
    onSuccess: (x) => {
      if (!x.data) return
      upsert(x.data)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t),
      })
    },
  }))

  function initGit() {
    if (gitMutation.isPending) return
    gitMutation.mutate()
  }

  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let scrollMark = 0
  let messageMark = 0

  const scrollGestureWindowMs = 250

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    setUi("scrollGesture", Date.now())
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < scrollGestureWindowMs

  const lagKey = "opencode.session.lag.debug"

  const lagging = () => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(lagKey) === "1"
  }

  const lag = (kind: string, fields: Record<string, string | number | boolean>) => {
    if (!lagging()) return
    const line = Object.entries(fields)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ")
    console.debug(`[lag] ${kind} ${line}`)
  }

  const sampleDom = () => {
    const root = scroller
    if (!root) return
    const list = content?.querySelector<HTMLElement>('[data-slot="session-turn-list"]')
    return {
      nodes: root.querySelectorAll("*").length,
      markdown: root.querySelectorAll('[data-component="markdown"]').length,
      full: root.querySelectorAll('[data-component="markdown"][data-markdown-stage="full"]').length,
      structure: root.querySelectorAll('[data-component="markdown"][data-markdown-stage="structure"]').length,
      lite: root.querySelectorAll('[data-component="markdown"][data-markdown-stage="lite"]').length,
      katex: root.querySelectorAll(".katex,.katex-display,.katex-html,.katex-mathml").length,
      buttons: root.querySelectorAll("button,[role='button']").length,
      listHeight: list ? Math.round(list.getBoundingClientRect().height) : "none",
      scrollTop: Math.round(root.scrollTop),
      scrollHeight: Math.round(root.scrollHeight),
      clientHeight: Math.round(root.clientHeight),
    }
  }

  const watchLag = (kind: string, target: EventTarget | null) => {
    if (!lagging()) return
    const now = performance.now()
    const el = target instanceof HTMLElement ? target : undefined
    const tag = el?.tagName.toLowerCase() || "unknown"
    const cls = el?.className && typeof el.className === "string" ? el.className.slice(0, 80) : "none"
    requestAnimationFrame(() => {
      const first = performance.now()
      requestAnimationFrame(() => {
        const second = performance.now()
        const total = Math.round(second - now)
        if (total < 50) return
        const dom = sampleDom()
        lag(kind, {
          sid: params.id || "none",
          total,
          first: Math.round(first - now),
          second: Math.round(second - now),
          tag,
          cls,
          ...dom,
        })
      })
    })
  }

  const debug = (_src: string, _el = scroller, _extra?: Record<string, unknown>) => {
  }

  createEffect(
    on([() => sdk.directory, () => params.id] as const, ([, id]) => {
      if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshFrame = undefined
      refreshTimer = undefined
      if (!id) return

      const cached = untrack(() => sync.data.message[id] !== undefined)
      const stale = !cached
        ? false
        : (() => {
            const info = getSessionPrefetch(sdk.directory, id)
            if (!info) return true
            return Date.now() - info.at > SESSION_PREFETCH_TTL
          })()
      const todos = untrack(() => sync.data.todo[id] !== undefined || globalSync.data.session_todo[id] !== undefined)

      untrack(() => {
        void sync.session.sync(id)
      })

      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = undefined
        refreshTimer = window.setTimeout(() => {
          refreshTimer = undefined
          if (params.id !== id) return
          untrack(() => {
            if (stale) void sync.session.sync(id, { force: true })
            void sync.session.todo(id, todos ? { force: true } : undefined)
          })
        }, 0)
      })
    }),
  )

  createEffect(() => {
    const el = root
    if (!el) return
    const over = (e: PointerEvent) => watchLag("hover", e.target)
    const down = (e: PointerEvent) => watchLag("down", e.target)
    const click = (e: MouseEvent) => watchLag("click", e.target)
    el.addEventListener("pointerover", over, true)
    el.addEventListener("pointerdown", down, true)
    el.addEventListener("click", click, true)
    onCleanup(() => {
      el.removeEventListener("pointerover", over, true)
      el.removeEventListener("pointerdown", down, true)
      el.removeEventListener("click", click, true)
    })
  })

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

  createEffect(
    on(
      sessionKey,
      () => {
        setStore("messageId", undefined)
        setStore("changes", "git")
        setUi("pendingMessage", undefined)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => sdk.directory,
      () => {
        resetVcs()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [sync.data.vcs?.branch, sync.data.vcs?.default_branch] as const,
      (next, prev) => {
        if (prev === undefined || same(next, prev)) return
        refreshVcs()
      },
      { defer: true },
    ),
  )

  const stopVcs = sdk.event.listen((evt) => {
    if (evt.details.type !== "file.watcher.updated") return
    const props =
      typeof evt.details.properties === "object" && evt.details.properties
        ? (evt.details.properties as Record<string, unknown>)
        : undefined
    const file = typeof props?.file === "string" ? props.file : undefined
    if (!file || file.startsWith(".git/")) return
    refreshVcs()
  })
  onCleanup(stopVcs)

  createEffect(
    on(
      () => params.dir,
      (dir) => {
        if (!dir) return
        setStore("newSessionWorktree", "main")
        setStore("newSessionPicked", false)
      },
      { defer: true },
    ),
  )

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
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

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(input.preview ? { preview: input.preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

  const isEditableTarget = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const deepActiveElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }
    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    // Prefer the open terminal over the composer when it can take focus
    if (view().terminal.opened()) {
      const id = terminal.active()
      if (id && shouldFocusTerminalOnKeyDown(event) && focusTerminalById(id)) return
    }

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      markScrollGesture()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composer.blocked()) return
      inputRef?.focus()
    }
  }

  const mobileChanges = createMemo(() => !isDesktop() && store.mobileTab === "changes")
  const wantsReview = createMemo(() =>
    isDesktop()
      ? desktopFileTreeOpen() || (desktopReviewOpen() && activeTab() === "review")
      : store.mobileTab === "changes",
  )

  createEffect(() => {
    const list = changesOptions()
    if (list.includes(store.changes)) return
    const next = list[0]
    if (!next) return
    setStore("changes", next)
  })

  createEffect(() => {
    const mode = vcsMode()
    if (!mode) return
    if (!wantsReview()) return
    void loadVcs(mode)
  })

  createEffect(
    on(
      () => sync.data.session_status[params.id ?? ""]?.type,
      (next, prev) => {
        const mode = vcsMode()
        if (!mode) return
        if (!wantsReview()) return
        if (next !== "idle" || prev === undefined || prev === "idle") return
        void loadVcs(mode, true)
      },
      { defer: true },
    ),
  )

  const fileTreeTab = () => layout.fileTree.tab()
  const setFileTreeTab = (value: "changes" | "all") => layout.fileTree.setTab(value)

  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLDivElement | undefined,
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })

  createEffect(
    on(
      sessionKey,
      () => {
        setTree({
          reviewScroll: undefined,
          pendingDiff: undefined,
          activeDiff: undefined,
        })
      },
      { defer: true },
    ),
  )

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    setFileTreeTab("all")
  }

  const focusInput = () => inputRef?.focus()

  useSessionCommands({
    navigateMessageByOffset,
    setActiveMessage,
    focusInput,
    explicitMessages: messages,
    visibleUserMessages,
    review: reviewTab,
  })

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActive: tabs().setActive,
    loadFile: file.load,
  })

  const changesTitle = () => {
    if (!canReview()) {
      return null
    }

    const label = (option: ChangeMode) => {
      if (option === "git") return language.t("ui.sessionReview.title.git")
      if (option === "branch") return language.t("ui.sessionReview.title.branch")
      if (option === "session") return language.t("ui.sessionReview.title")
      return language.t("ui.sessionReview.title.lastTurn")
    }

    return (
      <Select
        options={changesOptions()}
        current={store.changes}
        label={label}
        onSelect={(option) => option && setStore("changes", option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const empty = (text: string) => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{text}</div>
    </div>
  )

  const reviewEmptyText = createMemo(() => {
    if (store.changes === "git") return language.t("session.review.noUncommittedChanges")
    if (store.changes === "branch") return language.t("session.review.noBranchChanges")
    if (store.changes === "turn") return language.t("session.review.noChanges")
    return language.t(sessionEmptyKey())
  })

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (store.changes === "git" || store.changes === "branch") {
      if (!reviewReady()) return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      return empty(reviewEmptyText())
    }

    if (store.changes === "turn") {
      return empty(reviewEmptyText())
    }

    if (hasSessionReview() && !diffsReady()) {
      return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
    }

    if (sessionEmptyKey() === "session.review.noVcs") {
      return (
        <div class={input.emptyClass}>
          <div class="flex flex-col gap-3">
            <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
            <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
              {language.t("session.review.noVcs.createGit.description")}
            </div>
          </div>
          <Button size="large" disabled={gitMutation.isPending} onClick={initGit}>
            {gitMutation.isPending
              ? language.t("session.review.noVcs.createGit.actionLoading")
              : language.t("session.review.noVcs.createGit.action")}
          </Button>
        </div>
      )
    }

    return (
      <div class={input.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{reviewEmptyText()}</div>
      </div>
    )
  }

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <Show when={true}>
      <SessionReviewTab
        title={changesTitle()}
        empty={reviewEmpty(input)}
        diffs={reviewDiffs}
        view={view}
        diffStyle={input.diffStyle}
        onDiffStyleChange={input.onDiffStyleChange}
        onScrollRef={(el) => setTree("reviewScroll", el)}
        focusedFile={tree.activeDiff}
        onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
        onLineCommentUpdate={updateCommentInContext}
        onLineCommentDelete={removeCommentFromContext}
        lineCommentActions={reviewCommentActions()}
        comments={comments.all()}
        focusedComment={comments.focus()}
        onFocusedCommentChange={comments.setFocus}
        onViewFile={openReviewFile}
        classes={input.classes}
      />
    </Show>
  )

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  createEffect(
    on(
      activeFileTab,
      (active) => {
        if (!active) return
        if (fileTreeTab() !== "changes") return
        showAllFiles()
      },
      { defer: true },
    ),
  )

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = tree.reviewScroll
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
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    view().review.openPath(path)
    setTree({ activeDiff: path, pendingDiff: path })
  }

  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!reviewReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
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
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  createEffect(() => {
    const id = params.id
    if (!id) return

    if (!wantsReview()) return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return

    void sync.session.diff(id)
  })

  createEffect(
    on(
      () => [sessionKey(), wantsReview()] as const,
      ([key, wants]) => {
        if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
        if (diffTimer !== undefined) window.clearTimeout(diffTimer)
        diffFrame = undefined
        diffTimer = undefined
        if (!wants) return

        const id = params.id
        if (!id) return
        if (!untrack(() => sync.data.session_diff[id] !== undefined)) return

        diffFrame = requestAnimationFrame(() => {
          diffFrame = undefined
          diffTimer = window.setTimeout(() => {
            diffTimer = undefined
            if (sessionKey() !== key) return
            void sync.session.diff(id, { force: true })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk.directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return

    fileTreeTab()
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  createEffect(
    on(
      () => sdk.directory,
      () => {
        const tab = activeFileTab()
        if (!tab) return
        const path = file.pathFromTab(tab)
        if (!path) return
        void file.load(path, { force: true })
      },
      { defer: true },
    ),
  )

  const running = () => {
    const id = params.id
    if (!id) return false
    return working(sync.data.session_status[id], sync.data.message[id])
  }
  const autoScroll = createAutoScroll({
    working: running,
    overflowAnchor: "none",
    bottomThreshold: scrollBottomThreshold,
    resize: "off",
  })
  const live = () => running() && ui.mode === "live" && !autoScroll.userScrolled()
  const enterLive = () => {
    if (ui.mode === "live") return
    setUi("mode", "live")
  }
  const enterAnchored = () => {
    if (ui.mode === "anchored") return
    setUi("mode", "anchored")
  }

  const handleTimelineAutoScroll = () => {
    if (!running()) {
      console.debug("[session] idle auto-scroll gesture")
    }
    autoScroll.handleScroll()
  }

  // Streaming stability depends on locking the outer timeline directly to the
  // physical bottom. This avoids relying on the auto-scroll state machine once
  // content height is already changing every frame.
  const lockBottom = (el: HTMLDivElement, source: string, mode: "auto" | "smooth" = "auto") => {
    const next = Math.max(0, el.scrollHeight - el.clientHeight)
    const dist = next - el.scrollTop
    if (Math.abs(dist) <= 1) {
      debug("lock-bottom:skip", el, { source, dist: Math.round(dist) })
      return
    }
    if (mode === "smooth" && Math.abs(dist) <= smoothBottomSnapDistance) {
      const step =
        Math.sign(dist) * Math.min(Math.max(Math.abs(dist) * smoothBottomEase, 1), smoothBottomMaxStep)
      el.scrollTop += step
    } else {
      el.scrollTop = next
    }
    debug("lock-bottom:write", el, { source, dist: Math.round(dist) })
  }

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let fillFrame: number | undefined
  let initialScrollKey: string | undefined
  let initialScrollFrame: number | undefined
  let until = 0
  let jumpIntent = false
  const jumpToBottomIntent = () => jumpIntent
  const clearJumpIntent = () => {
    jumpIntent = false
  }

  const hasScrollTarget = () => !!location.hash || !!ui.pendingMessage || !!ui.seekingMessageId || !!store.messageId
  const settling = () => !!initialScrollKey && performance.now() < until && !hasScrollGesture()

  const settle = (key: string) => {
    initialScrollFrame = undefined
    if (sessionKey() !== key) {
      initialScrollKey = undefined
      if (scroller) scroller.style.visibility = ""
      return
    }
    if (hasScrollTarget() || hasScrollGesture()) {
      initialScrollKey = undefined
      if (scroller) scroller.style.visibility = ""
      return
    }

    const root = scroller
    if (!root) {
      initialScrollKey = undefined
      return
    }

    const gap = Math.round(root.scrollHeight - root.clientHeight - root.scrollTop)
    if (Math.abs(gap) > 1) console.debug(`[session] initial bottom settle gap=${gap}`)
    lockBottom(root, "initial-scroll:settle")
    scheduleScrollState(root)

    // Reveal the scroller once scrollTop is at the bottom (gap resolved)
    const gapAfter = Math.round(root.scrollHeight - root.clientHeight - root.scrollTop)
    if (root.style.visibility === "hidden" && Math.abs(gapAfter) <= 1) {
      root.style.visibility = ""
      console.warn(`[flash-debug] settle:reveal key=${key} time=${performance.now().toFixed(1)}`)
    }

    if (performance.now() >= until) {
      initialScrollKey = undefined
      if (root.style.visibility === "hidden") root.style.visibility = ""
      return
    }

    initialScrollFrame = requestAnimationFrame(() => settle(key))
  }

  const clamp = (el: HTMLDivElement, reason = "clamp") => {
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const top = Math.max(0, Math.min(el.scrollTop, max))
    if (Math.abs(el.scrollTop - top) <= 1) return top
    el.scrollTop = top
    return top
  }

  createResizeObserver(
    () => content,
    () => {
      const root = scroller
      if (!root) return
      debug("content-resize:before", root)
      clamp(root, "content:resize:clamp")
      // Deferred markdown/math expansion can increase content height after the
      // stream is already idle. If the viewport was still at the bottom before
      // that resize, keep it pinned instead of letting the tail drift upward.
      if ((live() || settling()) && !hasScrollTarget() && !hasScrollGesture()) {
        lockBottom(root, "content:resize:lock-bottom", live() ? "smooth" : "auto")
        if (root.style.visibility === "hidden") {
          const gap = Math.round(root.scrollHeight - root.clientHeight - root.scrollTop)
          if (Math.abs(gap) <= 1) {
            root.style.visibility = ""
            console.warn(`[flash-debug] content-resize:reveal time=${performance.now().toFixed(1)}`)
          }
        }
      }
      debug("content-resize:after", root)
      scheduleScrollState(root)
    },
  )

  const updateScrollState = (el: HTMLDivElement) => {
    if (!el.isConnected || el.clientHeight <= 0 || el.scrollHeight <= 0) return
    debug("state:before", el)
    if ((live() || settling()) && !hasScrollGesture() && !hasScrollTarget()) {
      lockBottom(el, "state:live-lock", live() ? "smooth" : "auto")
    }
    const top = clamp(el)
    const max = el.scrollHeight - el.clientHeight
    const overflow = max > 1
    const bottom = !overflow || max - top <= scrollBottomThreshold

    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom) {
      debug("state:same", el, { nextOverflow: overflow, nextBottom: bottom })
      return
    }
    setUi("scroll", { overflow, bottom })
    debug("state:update", el, { nextOverflow: overflow, nextBottom: bottom })
  }

  const scheduleScrollState = (el: HTMLDivElement) => {
    scrollStateTarget = el
    if (scrollStateFrame !== undefined) return

    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined

      const target = scrollStateTarget
      scrollStateTarget = undefined
      if (!target) return

      updateScrollState(target)
    })
  }

  const fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (!params.id || !messagesReady()) return
      if (autoScroll.userScrolled() || historyLoading()) return

      const el = scroller
      if (!el) return
      if (el.clientHeight <= 0 || el.scrollHeight <= 0) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (!historyMore()) return

      void loadEarlier()
    })
  }

  const resumeScroll = () => {
    jumpIntent = true
    setStore("messageId", undefined)
    setUi("seekingMessageId", undefined)
    clearMessageHash()

    const el = scroller
    if (el) {
      el.scrollTop = el.scrollHeight
      scheduleScrollState(el)
    }
  }

  // When the user returns to the bottom, treat the active message as "latest".
  createEffect(
    on(
      () => [sessionKey(), messagesReady(), !!scroller] as const,
      ([key, ready, mounted]) => {
        if (!ready) return
        if (!mounted) return
        if (initialScrollKey === key) return
        initialScrollKey = key
        if (initialScrollFrame !== undefined) cancelAnimationFrame(initialScrollFrame)

        // Synchronously scroll to bottom before the browser paints to prevent
        // the visible flash of the conversation top on session entry.
        if (!hasScrollTarget() && scroller) {
          // Hide the scroller until scroll position is settled at the bottom.
          // Content renders with scrollTop=0 initially because windowing disables
          // during session switch, causing a visible flash of the middle content.
          scroller.style.visibility = "hidden"
          const before = { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight }
          lockBottom(scroller, "initial-scroll:immediate")
          const after = { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight }
          console.warn(
            `[flash-debug] initial-scroll:immediate key=${key} before=${JSON.stringify(before)} after=${JSON.stringify(after)} time=${performance.now().toFixed(1)}`,
          )
          // If content doesn't overflow yet, keep hidden until settle resolves it
          if (scroller.scrollHeight <= scroller.clientHeight) {
            console.warn(`[flash-debug] initial-scroll:hidden (no overflow yet) key=${key}`)
          } else {
            // Content already overflows and lockBottom succeeded — reveal immediately
            scroller.style.visibility = ""
            console.warn(`[flash-debug] initial-scroll:revealed (overflow present) key=${key}`)
          }
        } else {
          console.warn(
            `[flash-debug] initial-scroll:SKIPPED key=${key} hasScrollTarget=${hasScrollTarget()} scroller=${!!scroller} time=${performance.now().toFixed(1)}`,
          )
        }

        initialScrollFrame = requestAnimationFrame(() => {
          const el1 = scroller
          console.warn(
            `[flash-debug] rAF-1 key=${key} scrollTop=${el1?.scrollTop} scrollHeight=${el1?.scrollHeight} clientHeight=${el1?.clientHeight} time=${performance.now().toFixed(1)}`,
          )
          initialScrollFrame = requestAnimationFrame(() => {
            initialScrollFrame = undefined
            if (sessionKey() !== key) {
              initialScrollKey = undefined
              if (scroller?.style.visibility === "hidden") scroller.style.visibility = ""
              return
            }
            if (hasScrollTarget()) {
              console.debug(
                `[session] initial bottom skipped: key=${key} hash=${location.hash || "none"} pending=${ui.pendingMessage || "none"} seeking=${ui.seekingMessageId || "none"} current=${store.messageId || "none"}`,
              )
              initialScrollKey = undefined
              if (scroller?.style.visibility === "hidden") scroller.style.visibility = ""
              return
            }
            const el = scroller
            if (!el) {
              initialScrollKey = undefined
              return
            }
            console.warn(
              `[flash-debug] rAF-2 key=${key} scrollTop=${el.scrollTop} scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight} time=${performance.now().toFixed(1)}`,
            )
            debug("initial:before", el, { key })
            setStore("messageId", undefined)
            enterLive()
            clearMessageHash()
            until = performance.now() + settleMs
            lockBottom(el, "initial-scroll:bottom")
            scheduleScrollState(el)
            debug("initial:after", el, { key })
            // Reveal if lockBottom brought us to the bottom
            const gapNow = Math.round(el.scrollHeight - el.clientHeight - el.scrollTop)
            if (el.style.visibility === "hidden" && Math.abs(gapNow) <= 1) {
              el.style.visibility = ""
              console.warn(`[flash-debug] rAF-2:reveal key=${key} time=${performance.now().toFixed(1)}`)
            }
            console.warn(
              `[flash-debug] rAF-2:done key=${key} scrollTop=${el.scrollTop} scrollHeight=${el.scrollHeight} time=${performance.now().toFixed(1)}`,
            )
            initialScrollFrame = requestAnimationFrame(() => settle(key))
          })
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        debug("user-scrolled:change", scroller, { scrolled })
        if (!running()) return
        if (scrolled) {
          enterAnchored()
          return
        }
        enterLive()
        setStore("messageId", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      running,
      (run) => {
        if (!run) return
        if (!ui.scroll.bottom) return
        if (ui.seekingMessageId || store.messageId) return
        console.debug("[session] streaming bottom follow enabled")
        autoScroll.resume()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => ui.scroll.bottom,
      (bottom, prev) => {
        debug("bottom:change", scroller, { prev, bottom })
        if (!bottom) return
        if (prev === undefined || prev === bottom) return
        if (ui.seekingMessageId) return
        if (!running()) {
          console.debug("[session] skip idle bottom resume")
          return
        }
        if (ui.mode !== "live") {
          enterLive()
          setStore("messageId", undefined)
          clearMessageHash()
        }
        if (!autoScroll.userScrolled()) return
        autoScroll.resume()
      },
      { defer: true },
    ),
  )

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    console.warn(
      `[flash-debug] setScrollRef: scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight} scrollTop=${el.scrollTop} key=${sessionKey()} ready=${messagesReady()} time=${performance.now().toFixed(1)}`,
    )
    debug("scroll-ref", el)
    scheduleScrollState(el)
    fill()

    // The initial-scroll effect (below) depends on !!scroller, but scroller is
    // a plain variable — not reactive. If messagesReady() fired before the DOM
    // mounted, the effect exited early and never re-runs. Compensate here by
    // triggering the initial scroll when the ref arrives late.
    const key = sessionKey()
    if (key && messagesReady() && initialScrollKey !== key) {
      initialScrollKey = key
      if (initialScrollFrame !== undefined) cancelAnimationFrame(initialScrollFrame)
      if (!hasScrollTarget()) {
        el.style.visibility = "hidden"
        lockBottom(el, "initial-scroll:ref-late")
        if (el.scrollHeight > el.clientHeight) {
          el.style.visibility = ""
        }
      }
      until = performance.now() + settleMs
      initialScrollFrame = requestAnimationFrame(() => settle(key))
    }
  }

  const markUserScroll = () => {
    scrollMark += 1
    debug("user-scroll", scroller, { mark: scrollMark })
  }

  const loadEarlier = async () => {
    const id = params.id
    if (!id) return
    if (!historyMore() || historyLoading()) return

    while (true) {
      const loaded = messages().length
      await sync.session.history.loadMore(id)
      if (params.id !== id) return
      const nextLoaded = messages().length
      if (visibleUserMessages().length > 0 && nextLoaded > loaded) return
      if (nextLoaded <= loaded) return
      if (!historyMore()) return
    }
  }

  createEffect(
    on(
      () =>
        [
          params.id,
          messagesReady(),
          historyMore(),
          historyLoading(),
          autoScroll.userScrolled(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (!more) return
        fill()
      },
      { defer: true },
    ),
  )

  const draft = (id: string) =>
    extractPromptFromParts(sync.data.part[id] ?? [], {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  const merge = (next: NonNullable<ReturnType<typeof info>>) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = next
      return out
    })

  const roll = (sessionID: string, next: NonNullable<ReturnType<typeof info>>["revert"]) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === sessionID)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = { ...out[idx], revert: next }
      return out
    })

  const busy = (sessionID: string) => {
    return working(sync.data.session_status[sessionID], sync.data.message[sessionID])
  }

  const queuedFollowups = createMemo(() => {
    const id = params.id
    if (!id) return emptyFollowups
    return followup.items[id] ?? emptyFollowups
  })

  const editingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    return followup.edit[id]
  })

  const followupMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; id: string; manual?: boolean }) => {
      const item = (followup.items[input.sessionID] ?? []).find((entry) => entry.id === input.id)
      if (!item) return

      if (input.manual) setFollowup("paused", input.sessionID, undefined)
      setFollowup("failed", input.sessionID, undefined)

      const ok = await sendFollowupDraft({
        client: sdk.client,
        sync,
        globalSync,
        draft: item,
        optimisticBusy: item.sessionDirectory === sdk.directory,
      }).catch((err) => {
        setFollowup("failed", input.sessionID, input.id)
        fail(err)
        return false
      })
      if (!ok) return

      setFollowup("items", input.sessionID, (items) => (items ?? []).filter((entry) => entry.id !== input.id))
      if (input.manual) resumeScroll()
    },
  }))

  const followupBusy = (sessionID: string) =>
    followupMutation.isPending && followupMutation.variables?.sessionID === sessionID

  const sendingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    if (!followupBusy(id)) return
    return followupMutation.variables?.id
  })

  const queueEnabled = createMemo(() => {
    const id = params.id
    if (!id) return false
    return settings.general.followup() === "queue" && busy(id) && !composer.blocked()
  })

  const followupText = (item: FollowupDraft) => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line)

    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const queueFollowup = (draft: FollowupDraft) => {
    setFollowup("items", draft.sessionID, (items) => [
      ...(items ?? []),
      { id: Identifier.ascending("message"), ...draft },
    ])
    setFollowup("failed", draft.sessionID, undefined)
    setFollowup("paused", draft.sessionID, undefined)
  }

  const followupDock = createMemo(() => queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })))

  const sendFollowup = (sessionID: string, id: string, opts?: { manual?: boolean }) => {
    const item = (followup.items[sessionID] ?? []).find((entry) => entry.id === id)
    if (!item) return Promise.resolve()
    if (followupBusy(sessionID)) return Promise.resolve()

    return followupMutation.mutateAsync({ sessionID, id, manual: opts?.manual })
  }

  const editFollowup = (id: string) => {
    const sessionID = params.id
    if (!sessionID) return
    if (followupBusy(sessionID)) return

    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return

    setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sessionID, (value) => (value === id ? undefined : value))
    setFollowup("edit", sessionID, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const clearFollowupEdit = () => {
    const id = params.id
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  const halt = (sessionID: string) =>
    busy(sessionID) ? sdk.client.session.abort({ sessionID }).catch(() => {}) : Promise.resolve()

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const prev = prompt.current().slice()
      const last = info()?.revert
      const value = draft(input.messageID)
      batch(() => {
        roll(input.sessionID, { messageID: input.messageID })
        prompt.set(value)
      })
      await halt(input.sessionID)
        .then(() => sdk.client.session.revert(input))
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(input.sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const sessionID = params.id
      if (!sessionID) return

      const next = userMessages().find((item) => item.id > id)
      const prev = prompt.current().slice()
      const last = info()?.revert

      batch(() => {
        roll(sessionID, next ? { messageID: next.id } : undefined)
        if (next) {
          prompt.set(draft(next.id))
          return
        }
        prompt.reset()
      })

      const task = !next
        ? halt(sessionID).then(() => sdk.client.session.unrevert({ sessionID }))
        : halt(sessionID).then(() =>
            sdk.client.session.revert({
              sessionID,
              messageID: next.id,
            }),
          )

      await task
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const fork = (input: { sessionID: string; messageID: string }) => {
    const value = draft(input.messageID)
    const dir = base64Encode(sdk.directory)
    return sdk.client.session
      .fork(input)
      .then((result) => {
        const next = result.data
        if (!next) {
          showToast({
            variant: "error",
            title: language.t("common.requestFailed"),
          })
          return
        }
        prompt.set(value, undefined, { dir, id: next.id })
        navigate(`/${dir}/session/${next.id}`)
      })
      .catch(fail)
  }

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!params.id || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const actions = { fork, revert }

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return

    const item = queuedFollowups()[0]
    if (!item) return
    if (followupBusy(sessionID)) return
    if (followup.failed[sessionID] === item.id) return
    if (followup.paused[sessionID]) return
    if (composer.blocked()) return
    if (busy(sessionID)) return

    void sendFollowup(sessionID, item.id)
  })

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const gap = el ? el.scrollHeight - el.clientHeight - el.scrollTop : 0
      const stick =
        el && !ui.seekingMessageId && running()
          ? !autoScroll.userScrolled() || gap <= scrollBottomThreshold + Math.max(0, delta)
          : false

      dockHeight = next

      if (el && stick) {
        requestAnimationFrame(() => {
          if (scroller !== el) return
          const top = el.scrollHeight - el.clientHeight - gap
          el.scrollTop = top > 0 ? top : 0
          clamp(el, "dock:resize:clamp")
        })
      }

      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey,
    sessionID: () => params.id,
    messagesReady,
    live,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    currentMessageId: () => store.messageId,
    pendingMessage: () => ui.pendingMessage,
    setPendingMessage: (value) => setUi("pendingMessage", value),
    setSeekingMessage: (value) => setUi("seekingMessageId", value),
    setActiveMessage,
    enterLive,
    enterAnchored,
    autoScroll,
    scroller: () => scroller,
    anchor,
    scheduleScrollState,
    consumePendingMessage: layout.pendingMessage.consume,
  })

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
    if (initialScrollFrame !== undefined) cancelAnimationFrame(initialScrollFrame)
    if (scroller?.style.visibility === "hidden") scroller.style.visibility = ""
  })

  return (
    <div
      ref={(el) => {
        root = el
      }}
      class="relative bg-background-base size-full overflow-hidden flex flex-col"
    >
      <SessionHeader />
      <div class="flex-1 min-h-0 flex flex-col md:flex-row">
        <Show when={!isDesktop() && !!params.id}>
          <Tabs value={store.mobileTab} class="h-auto">
            <Tabs.List>
              <Tabs.Trigger
                value="session"
                class="!w-1/2 !max-w-none"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "session")}
              >
                {language.t("session.tab.session")}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="changes"
                class="!w-1/2 !max-w-none !border-r-0"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "changes")}
              >
                {hasReview()
                  ? language.t("session.review.filesChanged", { count: reviewCount() })
                  : language.t("session.review.change.other")}
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Show>

        {/* Session panel */}
        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger flex-1 md:flex-none": true,
            "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
              !size.active() && !ui.reviewSnap,
          }}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id}>
                <Show when={messagesReady()}>
                  <MessageTimeline
                    mobileChanges={mobileChanges()}
                    mobileFallback={reviewContent({
                      diffStyle: "unified",
                      classes: {
                        root: "pb-8",
                        header: "px-4",
                        container: "px-4",
                      },
                      loadingClass: "px-4 py-4 text-text-weak",
                      emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
                    })}
                    actions={actions}
                    scroll={ui.scroll}
                    live={live()}
                    onResumeScroll={resumeScroll}
                    jumpToBottomIntent={jumpToBottomIntent}
                    onClearJumpIntent={clearJumpIntent}
                    setScrollRef={setScrollRef}
                    onScheduleScrollState={scheduleScrollState}
                    onAutoScrollHandleScroll={handleTimelineAutoScroll}
                    onMarkScrollGesture={markScrollGesture}
                    hasScrollGesture={hasScrollGesture}
                    onUserScroll={markUserScroll}
                    onAutoScrollInteraction={autoScroll.handleInteraction}
                    centered={centered()}
                    setContentRef={(el) => {
                      content = el
                      autoScroll.contentRef(el)

                      const root = scroller
                      if (root) scheduleScrollState(root)
                    }}
                    historyMore={historyMore()}
                    historyLoading={historyLoading()}
                    onLoadEarlier={() => {
                      void loadEarlier()
                    }}
                    renderedUserMessages={visibleUserMessages()}
                    currentMessageId={store.messageId}
                    seekingMessageId={ui.seekingMessageId}
                    onJumpToMessage={(message) => {
                      autoScroll.pause()
                      scrollToMessage(message, "auto")
                    }}
                    anchor={anchor}
                  />
                </Show>
              </Match>
              <Match when={true}>
                <NewSessionView
                  worktree={newSessionWorktree()}
                  onWorktreeChange={(value) => {
                    setStore("newSessionWorktree", value)
                    setStore("newSessionPicked", true)
                  }}
                />
              </Match>
            </Switch>
          </div>

          <SessionComposerRegion
            state={composer}
            ready={messagesReady()}
            centered={centered()}
            inputRef={(el) => {
              inputRef = el
            }}
            newSessionWorktree={newSessionWorktree()}
            onNewSessionWorktreeReset={() => {
              setStore("newSessionWorktree", "main")
              setStore("newSessionPicked", false)
            }}
            onSubmit={() => {
              comments.clear()
              resumeScroll()
            }}
            onSubmitted={() => {
              resumeScroll()
            }}
            onResponseSubmit={resumeScroll}
            followup={
              params.id
                ? {
                    queue: queueEnabled,
                    items: followupDock(),
                    sending: sendingFollowup(),
                    edit: editingFollowup(),
                    onQueue: queueFollowup,
                    onAbort: () => {
                      const id = params.id
                      if (!id) return
                      setFollowup("paused", id, true)
                    },
                    onSend: (id) => {
                      void sendFollowup(params.id!, id, { manual: true })
                    },
                    onEdit: editFollowup,
                    onEditLoaded: clearFollowupEdit,
                  }
                : undefined
            }
            revert={
              rolled().length > 0
                ? {
                    items: rolled(),
                    restoring: restoring(),
                    disabled: reverting(),
                    onRestore: restore,
                  }
                : undefined
            }
            setPromptDockRef={(el) => {
              promptDock = el
            }}
          />

          <Show when={desktopReviewOpen()}>
            <div onPointerDown={() => size.start()}>
              <ResizeHandle
                direction="horizontal"
                size={layout.session.width()}
                min={450}
                max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.45}
                onResize={(width) => {
                  size.touch()
                  layout.session.resize(width)
                }}
              />
            </div>
          </Show>
        </div>

        <SessionSidePanel
          canReview={canReview}
          diffs={reviewDiffs}
          diffsReady={reviewReady}
          empty={reviewEmptyText}
          hasReview={hasReview}
          reviewCount={reviewCount}
          reviewPanel={reviewPanel}
          activeDiff={tree.activeDiff}
          focusReviewDiff={focusReviewDiff}
          reviewSnap={ui.reviewSnap}
          size={size}
        />
      </div>

      <TerminalPanel />
    </div>
  )
}
