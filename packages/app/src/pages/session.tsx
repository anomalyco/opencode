import type { Project, UserMessage, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { Message, SessionPending, SessionPendingItem, SessionStatus } from "@opencode-ai/sdk/v2/client"
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
import { makeEventListener } from "@solid-primitives/event-listener"
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
import { findLast } from "@opencode-ai/util/array"
import { checksum } from "@opencode-ai/util/encode"
import { retry } from "@opencode-ai/util/retry"
import { useSearchParams } from "@solidjs/router"
import { NewSessionView, SessionHeader } from "@/components/session"
import { useComments } from "@/context/comments"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { type FollowupDraft } from "@/components/prompt-input/submit"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import {
  createOpenReviewFile,
  createSessionTabs,
  createSizing,
  focusTerminalById,
  shouldFocusTerminalOnKeyDown,
} from "@/pages/session/helpers"
import {
  createPendingSnapshotCoordinator,
  derivePendingControllerState,
  getEditCancelBlockReason,
  getEditSaveBlockReason,
  getHistoryMutationBlockReason,
  type PendingBlockReason,
  type PendingMutationOptions,
  getPendingItemActionBlockReason,
  getPendingMoveLaneBlockReason,
  getQueueSubmitBlockReason,
  getResumeBlockReason,
  getStartEditBlockReason,
  getSteerSubmitBlockReason,
  getVisibleEditingItemID,
  resolveFollowupLane,
  shouldClearLocalStopProjection,
} from "@/pages/session/pending-controller"
import {
  clearPromptContextItems,
  fromPendingDraft,
  pendingDraftPreview,
  restoreComposerFromRequestParts,
  restorePromptContextItems,
  toPendingDraft,
} from "@/pages/session/pending-draft"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { useSessionLayout } from "@/pages/session/session-layout"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"
import { Identifier } from "@/utils/id"
import { diffs as list } from "@/utils/diffs"
import { extractPromptFromParts } from "@/utils/prompt"
import { same } from "@/utils/same"
import { formatServerError } from "@/utils/server-errors"

const emptyUserMessages: UserMessage[] = []
const emptyPending: SessionPending = { paused: false, steer: [], queue: [] }
const STALE_INCOMPLETE_ASSISTANT_SYNC_GRACE_MS = 4_000

type ChangeMode = "git" | "branch" | "turn"
type VcsMode = "git" | "branch"

type SessionHistoryWindowInput = {
  sessionID: () => string | undefined
  messagesReady: () => boolean
  loaded: () => number
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  loadMore: (sessionID: string) => Promise<void>
  userScrolled: () => boolean
  scroller: () => HTMLDivElement | undefined
}

/**
 * Maintains the rendered history window for a session timeline.
 *
 * It keeps initial paint bounded to recent turns, reveals cached turns in
 * small batches while scrolling upward, and prefetches older history near top.
 */
function createSessionHistoryWindow(input: SessionHistoryWindowInput) {
  const turnInit = 10
  const turnBatch = 8
  const turnScrollThreshold = 200
  const turnPrefetchBuffer = 16
  const prefetchCooldownMs = 400
  const prefetchNoGrowthLimit = 2

  const [state, setState] = createStore({
    turnID: undefined as string | undefined,
    turnStart: 0,
    prefetchUntil: 0,
    prefetchNoGrowth: 0,
  })

  const initialTurnStart = (len: number) => (len > turnInit ? len - turnInit : 0)

  const turnStart = createMemo(() => {
    const id = input.sessionID()
    const len = input.visibleUserMessages().length
    if (!id || len <= 0) return 0
    if (state.turnID !== id) return initialTurnStart(len)
    if (state.turnStart <= 0) return 0
    if (state.turnStart >= len) return initialTurnStart(len)
    return state.turnStart
  })

  const setTurnStart = (start: number) => {
    const id = input.sessionID()
    const next = start > 0 ? start : 0
    if (!id) {
      setState({ turnID: undefined, turnStart: next })
      return
    }
    setState({ turnID: id, turnStart: next })
  }

  const renderedUserMessages = createMemo(
    () => {
      const msgs = input.visibleUserMessages()
      const start = turnStart()
      if (start <= 0) return msgs
      return msgs.slice(start)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )

  const preserveScroll = (fn: () => void) => {
    const el = input.scroller()
    if (!el) {
      fn()
      return
    }
    const beforeTop = el.scrollTop
    const beforeHeight = el.scrollHeight
    fn()
    requestAnimationFrame(() => {
      const delta = el.scrollHeight - beforeHeight
      if (!delta) return
      el.scrollTop = beforeTop + delta
    })
  }

  const backfillTurns = () => {
    const start = turnStart()
    if (start <= 0) return

    const next = start - turnBatch
    const nextStart = next > 0 ? next : 0

    preserveScroll(() => setTurnStart(nextStart))
  }

  /** Button path: reveal all cached turns, fetch older history, reveal one batch. */
  const loadAndReveal = async () => {
    const id = input.sessionID()
    if (!id) return

    const start = turnStart()
    const beforeVisible = input.visibleUserMessages().length
    let loaded = input.loaded()

    if (start > 0) setTurnStart(0)

    if (!input.historyMore() || input.historyLoading()) return

    let afterVisible = beforeVisible
    let added = 0

    while (true) {
      await input.loadMore(id)
      if (input.sessionID() !== id) return

      afterVisible = input.visibleUserMessages().length
      const nextLoaded = input.loaded()
      const raw = nextLoaded - loaded
      added += raw
      loaded = nextLoaded

      if (afterVisible > beforeVisible) break
      if (raw <= 0) break
      if (!input.historyMore()) break
    }

    if (added <= 0) return
    if (state.prefetchNoGrowth) setState("prefetchNoGrowth", 0)

    const growth = afterVisible - beforeVisible
    if (growth <= 0) return
    if (turnStart() !== 0) return

    const target = Math.min(afterVisible, beforeVisible + turnBatch)
    setTurnStart(Math.max(0, afterVisible - target))
  }

  /** Scroll/prefetch path: fetch older history from server. */
  const fetchOlderMessages = async (opts?: { prefetch?: boolean }) => {
    const id = input.sessionID()
    if (!id) return
    if (!input.historyMore() || input.historyLoading()) return

    if (opts?.prefetch) {
      const now = Date.now()
      if (state.prefetchUntil > now) return
      if (state.prefetchNoGrowth >= prefetchNoGrowthLimit) return
      setState("prefetchUntil", now + prefetchCooldownMs)
    }

    const start = turnStart()
    const beforeVisible = input.visibleUserMessages().length
    const beforeRendered = start <= 0 ? beforeVisible : renderedUserMessages().length
    let loaded = input.loaded()
    let added = 0
    let growth = 0

    while (true) {
      await input.loadMore(id)
      if (input.sessionID() !== id) return

      const nextLoaded = input.loaded()
      const raw = nextLoaded - loaded
      added += raw
      loaded = nextLoaded
      growth = input.visibleUserMessages().length - beforeVisible

      if (growth > 0) break
      if (raw <= 0) break
      if (!input.historyMore()) break
    }

    const afterVisible = input.visibleUserMessages().length

    if (opts?.prefetch) {
      setState("prefetchNoGrowth", added > 0 ? 0 : state.prefetchNoGrowth + 1)
    } else if (added > 0 && state.prefetchNoGrowth) {
      setState("prefetchNoGrowth", 0)
    }

    if (added <= 0) return
    if (growth <= 0) return

    if (opts?.prefetch) {
      const current = turnStart()
      preserveScroll(() => setTurnStart(current + growth))
      return
    }

    if (turnStart() !== start) return

    const currentRendered = renderedUserMessages().length
    const base = Math.max(beforeRendered, currentRendered)
    const target = Math.min(afterVisible, base + turnBatch)
    preserveScroll(() => setTurnStart(Math.max(0, afterVisible - target)))
  }

  const onScrollerScroll = () => {
    if (!input.userScrolled()) return
    const el = input.scroller()
    if (!el) return
    if (el.scrollTop >= turnScrollThreshold) return

    const start = turnStart()
    if (start > 0) {
      if (start <= turnPrefetchBuffer) {
        void fetchOlderMessages({ prefetch: true })
      }
      backfillTurns()
      return
    }

    void fetchOlderMessages()
  }

  createEffect(
    on(
      input.sessionID,
      () => {
        setState({ prefetchUntil: 0, prefetchNoGrowth: 0 })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [input.sessionID(), input.messagesReady()] as const,
      ([id, ready]) => {
        if (!id || !ready) return
        setTurnStart(initialTurnStart(input.visibleUserMessages().length))
      },
      { defer: true },
    ),
  )

  return {
    turnStart,
    setTurnStart,
    renderedUserMessages,
    loadAndReveal,
    onScrollerScroll,
  }
}

export default function Page() {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const settings = useSettings()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      if (params.id) return
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  const [ui, setUi] = createStore({
    pendingMessage: undefined as string | undefined,
    reviewSnap: false,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
      jump: false,
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
  const isChildSession = createMemo(() => !!info()?.parentID)
  const diffs = createMemo(() => (params.id ? list(sync.data.session_diff[params.id]) : []))
  const sessionCount = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const hasSessionReview = createMemo(() => sessionCount() > 0)
  const canReview = createMemo(() => !!sync.project)
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
    deferRender: false,
  })

  const [vcs, setVcs] = createStore<{
    diff: {
      git: VcsFileDiff[]
      branch: VcsFileDiff[]
    }
    ready: {
      git: boolean
      branch: boolean
    }
  }>({
    diff: {
      git: [] as VcsFileDiff[],
      branch: [] as VcsFileDiff[],
    },
    ready: {
      git: false,
      branch: false,
    },
  })

  const [pendingUI, setPendingUI] = createStore({
    loading: {} as Record<string, boolean | undefined>,
    fresh: {} as Record<string, boolean | undefined>,
    mutating: {} as Record<string, boolean | undefined>,
    historyMutating: {} as Record<string, boolean | undefined>,
    localEdit: {} as Record<string, string | undefined>,
    stopProjected: {} as Record<string, boolean | undefined>,
    stopProjectedAtUserMessage: {} as Record<string, string | null | undefined>,
  })

  createComputed((prev) => {
    const key = sessionKey()
    if (key !== prev) {
      setStore("deferRender", true)
      requestAnimationFrame(() => {
        setTimeout(() => setStore("deferRender", false), 0)
      })
    }
    return key
  }, sessionKey())

  let reviewFrame: number | undefined
  let refreshFrame: number | undefined
  let refreshTimer: number | undefined
  let todoFrame: number | undefined
  let todoTimer: number | undefined
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
        setVcs("diff", mode, list(result.data))
        setVcs("ready", mode, true)
      })
      .catch((error) => {
        if (vcsRun.get(mode) !== run) return
        console.debug("[session-review] failed to load vcs diff", { mode, error })
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
  const nogit = createMemo(() => !!sync.project && sync.project.vcs !== "git")
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
    list.push("turn")
    return list
  })
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    if (store.changes === "git" || store.changes === "branch") return store.changes
  })
  const reviewDiffs = createMemo(() => {
    if (store.changes === "git") return list(vcs.diff.git)
    if (store.changes === "branch") return list(vcs.diff.branch)
    return turnDiffs()
  })
  const reviewCount = createMemo(() => reviewDiffs().length)
  const hasReview = createMemo(() => reviewCount() > 0)
  const reviewReady = createMemo(() => {
    if (store.changes === "git") return vcs.ready.git
    if (store.changes === "branch") return vcs.ready.branch
    return true
  })

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync.project
    if (project && sdk.directory !== project.worktree) return sdk.directory
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
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

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
          })
        }, 0)
      })
    }),
  )

  createEffect(
    on(
      () => {
        const id = params.id
        return [
          sdk.directory,
          id,
          id ? (sync.data.session_status[id]?.type ?? "idle") : "idle",
          id ? composer.blocked() : false,
        ] as const
      },
      ([dir, id, status, blocked]) => {
        if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
        if (todoTimer !== undefined) window.clearTimeout(todoTimer)
        todoFrame = undefined
        todoTimer = undefined
        if (!id) return
        if (status === "idle" && !blocked) return
        const cached = untrack(() => sync.data.todo[id] !== undefined || globalSync.data.session_todo[id] !== undefined)

        todoFrame = requestAnimationFrame(() => {
          todoFrame = undefined
          todoTimer = window.setTimeout(() => {
            todoTimer = undefined
            if (sdk.directory !== dir || params.id !== id) return
            untrack(() => {
              void sync.session.todo(id, cached ? { force: true } : undefined)
            })
          }, 0)
        })
      },
      { defer: true },
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
      if (composer.blocked() || isChildSession()) return
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

  const focusInput = () => {
    if (isChildSession()) return
    inputRef?.focus()
  }

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

  const createGit = (input: { emptyClass: string }) => (
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

  const reviewEmptyText = createMemo(() => {
    if (store.changes === "git") return language.t("session.review.noUncommittedChanges")
    if (store.changes === "branch") return language.t("session.review.noBranchChanges")
    return language.t("session.review.noChanges")
  })

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (store.changes === "git" || store.changes === "branch") {
      if (!reviewReady()) return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      return empty(reviewEmptyText())
    }

    if (store.changes === "turn") {
      if (nogit()) return createGit(input)
      return empty(reviewEmptyText())
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
    <Show when={!store.deferRender}>
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
        commentMentions={{
          items: file.searchFilesAndDirectories,
        }}
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

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let fillFrame: number | undefined

  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)

  const updateScrollState = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
    const overflow = max > 1
    const bottom = !overflow || distance <= 2
    const jump = overflow && distance > jumpThreshold(el)

    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom && ui.scroll.jump === jump) return
    setUi("scroll", { overflow, bottom, jump })
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

  const resumeScroll = () => {
    setStore("messageId", undefined)
    autoScroll.forceScrollToBottom()
    clearMessageHash()

    const el = scroller
    if (el) scheduleScrollState(el)
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

  let fill = () => {}

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
    fill()
  }

  const markUserScroll = () => {
    scrollMark += 1
  }

  createResizeObserver(
    () => content,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const historyWindow = createSessionHistoryWindow({
    sessionID: () => params.id,
    messagesReady,
    loaded: () => messages().length,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
  })

  const waitForHistoryLoad = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })

  const nextRevertBoundaryLoadStep = () => {
    const revertID = revertMessageID()
    if (!revertID) return "done" as const
    if (!messagesReady()) return "wait" as const

    const loaded = userMessages()
    if (loaded.length === 0) {
      if (historyLoading()) return "wait" as const
      if (!historyMore()) return "done" as const
      return "load" as const
    }
    if (loaded.some((item) => item.id === revertID)) return "done" as const

    const oldestLoaded = loaded[0]?.id
    if (!oldestLoaded || oldestLoaded <= revertID) return "done" as const
    if (historyLoading()) return "wait" as const
    if (!historyMore()) return "done" as const
    return "load" as const
  }

  const ensureRevertBoundaryLoaded = async (sessionID: string) => {
    while (params.id === sessionID) {
      const step = nextRevertBoundaryLoadStep()
      if (step === "done") return
      if (step === "wait") {
        await waitForHistoryLoad()
        continue
      }
      await sync.session.history.loadMore(sessionID)
    }
  }

  const nextUndoBoundaryLoadStep = () => {
    const revertID = revertMessageID()
    if (!revertID) return "done" as const
    if (!messagesReady()) return "wait" as const

    const loaded = userMessages()
    if (loaded.length === 0) {
      if (historyLoading()) return "wait" as const
      if (!historyMore()) return "done" as const
      return "load" as const
    }
    if (loaded.some((item) => item.id < revertID)) return "done" as const
    if (historyLoading()) return "wait" as const
    if (!historyMore()) return "done" as const
    return "load" as const
  }

  const ensureUndoBoundaryLoaded = async (sessionID: string) => {
    while (params.id === sessionID) {
      const step = nextUndoBoundaryLoadStep()
      if (step === "done") return
      if (step === "wait") {
        await waitForHistoryLoad()
        continue
      }
      await sync.session.history.loadMore(sessionID)
    }
  }

  fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (!params.id || !messagesReady()) return
      if (autoScroll.userScrolled() || historyLoading()) return

      const el = scroller
      if (!el) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (historyWindow.turnStart() <= 0 && !historyMore()) return

      void historyWindow.loadAndReveal()
    })
  }

  createEffect(
    on(
      () =>
        [
          params.id,
          messagesReady(),
          historyWindow.turnStart(),
          historyMore(),
          historyLoading(),
          autoScroll.userScrolled(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, start, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (start <= 0 && !more) return
        fill()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () =>
        [
          params.id,
          revertMessageID(),
          messagesReady(),
          historyLoading(),
          historyMore(),
          userMessages()[0]?.id,
        ] as const,
      ([sessionID]) => {
        if (!sessionID || nextRevertBoundaryLoadStep() !== "load") return
        void sync.session.history.loadMore(sessionID)
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

  const pendingRefreshErrorMeta = Symbol("pending-refresh-error")
  const backgroundPendingRefreshCounts = new Map<string, number>()
  const foregroundPendingRefreshCounts = new Map<string, number>()

  const updatePendingRefreshCount = (map: Map<string, number>, sessionID: string, delta: 1 | -1) => {
    const next = (map.get(sessionID) ?? 0) + delta
    if (next > 0) {
      map.set(sessionID, next)
      return
    }
    map.delete(sessionID)
  }

  const trackPendingRefresh = <T,>(sessionID: string, background: boolean, task: () => Promise<T>) => {
    const counts = background ? backgroundPendingRefreshCounts : foregroundPendingRefreshCounts
    updatePendingRefreshCount(counts, sessionID, 1)
    return task().finally(() => {
      updatePendingRefreshCount(counts, sessionID, -1)
    })
  }

  const tagPendingRefreshError = (sessionID: string, error: unknown) => ({
    [pendingRefreshErrorMeta]: {
      error,
      silent:
        (foregroundPendingRefreshCounts.get(sessionID) ?? 0) === 0 &&
        (backgroundPendingRefreshCounts.get(sessionID) ?? 0) > 0,
    },
  })

  const unwrapPendingRefreshError = (error: unknown) => {
    if (!error || typeof error !== "object") return
    const meta = (error as Record<PropertyKey, unknown>)[pendingRefreshErrorMeta]
    if (!meta || typeof meta !== "object") return
    if (!("error" in meta) || !("silent" in meta)) return
    return meta as { error: unknown; silent: boolean }
  }

  const reportPendingError = (error: unknown) => {
    const tagged = unwrapPendingRefreshError(error)
    if (tagged) {
      if (!tagged.silent) fail(tagged.error)
      return
    }
    fail(error)
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

  const latestIncompleteAssistant = (sessionID: string) =>
    findLast(
      sync.data.message[sessionID] ?? [],
      (item) => item.role === "assistant" && typeof item.time.completed !== "number",
    )

  const hasIncompleteAssistant = (sessionID: string) => !!latestIncompleteAssistant(sessionID)

  const latestUserMessageID = (sessionID: string) =>
    findLast(sync.data.message[sessionID] ?? [], (item) => item.role === "user")?.id

  const busy = (sessionID: string) => {
    if ((sync.data.session_status[sessionID] ?? { type: "idle" as const }).type !== "idle") return true
    return hasIncompleteAssistant(sessionID)
  }

  const clearPromptContext = () => {
    clearPromptContextItems(prompt.context.items(), (key) => prompt.context.remove(key))
  }

  const restorePromptContext = (items: ReturnType<typeof prompt.context.items>) => {
    restorePromptContextItems(items, (item) =>
      prompt.context.add({
        type: item.type,
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
      }),
    )
  }

  const restoreComposerFromParts = (parts: unknown[] | undefined) => {
    return restoreComposerFromRequestParts({
      parts,
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
      existingComments: comments.all(),
      currentContextItems: () => prompt.context.items(),
      removeContext: (key) => prompt.context.remove(key),
      addContext: (item) =>
        prompt.context.add({
          type: item.type,
          path: item.path,
          selection: item.selection,
          comment: item.comment,
          commentID: item.commentID,
          commentOrigin: item.commentOrigin,
          preview: item.preview,
        }),
      replaceComments: (next) => comments.replace(next),
      setPrompt: (next) => prompt.set(next),
    })
  }

  const restoreHistoryComposer = (messageID?: string) => {
    if (messageID && restoreComposerFromParts(sync.data.part[messageID])) return
    batch(() => {
      clearPromptContext()
      comments.clear()
      if (messageID) {
        prompt.set(draft(messageID))
        return
      }
      prompt.reset()
    })
  }

  const isSteerUnavailableError = (error: unknown) =>
    typeof error === "object" && error !== null && "name" in error && error.name === "SessionSteerUnavailableError"
  const isPendingConflictError = (error: unknown) =>
    typeof error === "object" && error !== null && "name" in error && error.name === "SessionPendingConflictError"

  const pendingStateKnown = (sessionID: string) => sync.data.session_pending[sessionID] !== undefined
  const pendingStateFresh = (sessionID: string) => pendingStateKnown(sessionID) && !!pendingUI.fresh[sessionID]
  const rawPendingState = (sessionID: string) => sync.data.session_pending[sessionID] ?? emptyPending
  const pendingItemByID = (sessionID: string, itemID: string | undefined) => {
    if (!itemID || !pendingStateKnown(sessionID)) return undefined
    const pending = rawPendingState(sessionID)
    return [...pending.steer, ...pending.queue].find((item) => item.id === itemID)
  }

  const pendingSnapshotStore = (directory?: string) => sync.child(directory)[0]
  const pendingSnapshotSet = (directory?: string) => sync.child(directory)[1]
  const currentPendingDirectory = () => sdk.directory

  const pendingCoordinator = createPendingSnapshotCoordinator({
    emptyState: emptyPending,
    isKnown: (sessionID, directory) => pendingSnapshotStore(directory).session_pending[sessionID] !== undefined,
    read: (sessionID, directory) => pendingSnapshotStore(directory).session_pending[sessionID] ?? emptyPending,
    write: (sessionID, next, directory) => pendingSnapshotSet(directory)("session_pending", sessionID, next),
    isLoading: (sessionID) => !!pendingUI.loading[sessionID],
    setLoading: (sessionID, next) => setPendingUI("loading", sessionID, next),
    isMutating: (sessionID) => !!pendingUI.mutating[sessionID],
    setMutating: (sessionID, next) => setPendingUI("mutating", sessionID, next),
    fetch: async (sessionID, directory) => {
      const client = directory ? sdk.createClient({ directory, throwOnError: true }) : sdk.client
      try {
        const result = await retry(() => client.session.pending({ sessionID }))
        return result.data
      } catch (error) {
        throw tagPendingRefreshError(sessionID, error)
      }
    },
    onError: reportPendingError,
  })

  const refreshPending = async (
    sessionID: string,
    opts?: { force?: boolean; supersede?: boolean; directory?: string; background?: boolean },
  ) =>
    trackPendingRefresh(sessionID, !!opts?.background, async () => {
      const result = await pendingCoordinator.refresh(sessionID, {
        force: opts?.force,
        supersede: opts?.supersede,
        directory: opts?.directory ?? currentPendingDirectory(),
        background: opts?.background,
      })
      if (result === "applied") {
        setPendingUI("fresh", sessionID, true)
      }
      return result
    })

  const statusRefreshInFlight = new Map<string, Promise<Record<string, SessionStatus> | undefined>>()
  const refreshSessionStatus = (directory = currentPendingDirectory()) => {
    const existing = statusRefreshInFlight.get(directory)
    if (existing) return existing
    const client = directory ? sdk.createClient({ directory, throwOnError: true }) : sdk.client
    const task = retry(() => client.session.status())
      .then((result) => {
        if (result.data) pendingSnapshotSet(directory)("session_status", result.data)
        return result.data
      })
      .catch((error) => {
        reportPendingError(error)
        return undefined
      })
      .finally(() => {
        if (statusRefreshInFlight.get(directory) === task) statusRefreshInFlight.delete(directory)
      })
    statusRefreshInFlight.set(directory, task)
    return task
  }

  const completeLocalAssistantIfRemoteCompleted = async (sessionID: string, messageID: string) => {
    const messages = await retry(() => sdk.client.session.messages({ sessionID, limit: 80 }))
    const message = (messages.data ?? []).find((item) => item.info?.id === messageID)?.info
    if (message?.role !== "assistant" || typeof message.time.completed !== "number") return false
    if (params.id !== sessionID) return false

    let updated = false
    sync.set("message", sessionID, (current: Message[] | undefined) => {
      if (!current) return current
      const index = current.findIndex((item) => item.id === messageID)
      if (index === -1 || current[index]?.role !== "assistant") return current
      const next = current.slice()
      next[index] = message
      updated = true
      return next
    })
    return updated
  }

  const invalidatePending = (sessionID: string, opts?: { directory?: string }) => {
    setPendingUI("fresh", sessionID, false)
    setPendingUI("loading", sessionID, true)
    return refreshPending(sessionID, {
      force: true,
      directory: opts?.directory ?? currentPendingDirectory(),
    })
  }

  const blockPending = (sessionID: string, reason?: PendingBlockReason, directory = currentPendingDirectory()) =>
    pendingCoordinator.blocked(sessionID, reason, { directory })

  const pendingMutationTasks = new Map<string, Promise<unknown>>()
  const trackPendingMutation = <T,>(sessionID: string, task: Promise<T>) => {
    const tracked = task.catch(() => undefined).finally(() => {
      if (pendingMutationTasks.get(sessionID) === tracked) pendingMutationTasks.delete(sessionID)
    })
    pendingMutationTasks.set(sessionID, tracked)
    return task
  }

  const mutatePending = (
    sessionID: string,
    reason: PendingBlockReason | undefined,
    task: () => Promise<{ data?: SessionPending }>,
    opts?: PendingMutationOptions,
  ) =>
    trackPendingMutation(
      sessionID,
      pendingCoordinator
        .mutate(sessionID, reason, task, {
          ...opts,
          directory: opts?.directory ?? currentPendingDirectory(),
        })
        .then((result) => {
          if (result.kind === "applied") {
            setPendingUI("fresh", sessionID, true)
          }
          return result
        })
        .catch((error) => {
          void invalidatePending(sessionID, { directory: opts?.directory })
          throw error
        }),
    )

  const waitForPendingMutation = async (sessionID: string) => {
    while (pendingUI.mutating[sessionID]) {
      const task = pendingMutationTasks.get(sessionID)
      if (!task) {
        await Promise.resolve()
        return
      }
      await task
    }
  }

  const pendingRowActionQueue = new Map<string, Promise<unknown>>()
  const enqueuePendingRowAction = <T,>(sessionID: string, task: () => T | Promise<T>) => {
    const previous = pendingRowActionQueue.get(sessionID) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        await waitForPendingMutation(sessionID)
        return task()
      })
    const tracked = current.finally(() => {
      if (pendingRowActionQueue.get(sessionID) === tracked) pendingRowActionQueue.delete(sessionID)
    })
    pendingRowActionQueue.set(sessionID, tracked)
    return current
  }

  createEffect(
    on(
      () => params.id,
      (sessionID) => {
        if (!sessionID) return
        setPendingUI("fresh", sessionID, false)
        setPendingUI("loading", sessionID, true)
        void untrack(() => refreshPending(sessionID, { force: true, background: true }))
        const timer = window.setInterval(() => {
          void refreshPending(sessionID, { force: true, background: true })
        }, 1000)
        onCleanup(() => window.clearInterval(timer))
      },
    ),
  )

  createEffect(
    on(
      () => [params.id, sync.data.session_status[params.id ?? ""]?.type] as const,
      ([sessionID]) => {
        if (!sessionID || pendingUI.mutating[sessionID]) return
        void untrack(() => refreshPending(sessionID, { force: true, background: true }))
      },
      { defer: true },
    ),
  )

  const incompleteAssistantStatusMissingSince = new Map<string, number>()

  createEffect(
    on(
      () => params.id,
      (sessionID) => {
        if (!sessionID) return

        const reconcile = () => {
          if (!busy(sessionID)) {
            incompleteAssistantStatusMissingSince.delete(sessionID)
            return
          }
          if (sync.data.session_status[sessionID]) {
            incompleteAssistantStatusMissingSince.delete(sessionID)
            return
          }

          void refreshSessionStatus().then(async (statuses) => {
            if (params.id !== sessionID || !statuses) return
            const incompleteAssistant = latestIncompleteAssistant(sessionID)
            if (statuses[sessionID] || !incompleteAssistant) {
              incompleteAssistantStatusMissingSince.delete(sessionID)
              return
            }

            const now = Date.now()
            const missingSince = incompleteAssistantStatusMissingSince.get(sessionID) ?? now
            incompleteAssistantStatusMissingSince.set(sessionID, missingSince)
            if (now - missingSince < STALE_INCOMPLETE_ASSISTANT_SYNC_GRACE_MS) return

            if (latestIncompleteAssistant(sessionID)?.id !== incompleteAssistant.id) {
              incompleteAssistantStatusMissingSince.delete(sessionID)
              return
            }
            const completed = await completeLocalAssistantIfRemoteCompleted(sessionID, incompleteAssistant.id).catch(
              () => false,
            )
            if (completed) incompleteAssistantStatusMissingSince.delete(sessionID)
          })
        }

        reconcile()
        const timer = window.setInterval(reconcile, 1000)
        onCleanup(() => {
          window.clearInterval(timer)
          incompleteAssistantStatusMissingSince.delete(sessionID)
        })
      },
    ),
  )

  createEffect(
    on(
      () => [params.id, sync.data.session_pending[params.id ?? ""]] as const,
      ([sessionID, pending], prev) => {
        if (!sessionID || !pending) return
        if (sessionID !== prev?.[0]) return
        if (pending === prev?.[1]) return
        setPendingUI("fresh", sessionID, true)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => {
        const sessionID = params.id
        return [
          sessionID,
          sessionID ? pendingUI.stopProjected[sessionID] : undefined,
          sessionID ? pendingUI.stopProjectedAtUserMessage[sessionID] : undefined,
          sessionID ? latestUserMessageID(sessionID) : undefined,
          sync.data.session_pending[sessionID ?? ""],
        ] as const
      },
      ([sessionID, projected, projectedAtUserMessage, currentUserMessage, pending]) => {
        if (!sessionID || !projected || !pending) return
        if (
          shouldClearLocalStopProjection({
            projected,
            pending,
            runtime: busy(sessionID) ? "busy" : "idle",
            projectedAtUserMessageID: projectedAtUserMessage,
            latestUserMessageID: currentUserMessage,
          })
        ) {
          batch(() => {
            setPendingUI("stopProjected", sessionID, undefined)
            setPendingUI("stopProjectedAtUserMessage", sessionID, undefined)
          })
        }
      },
      { defer: true },
    ),
  )

  const optimisticStopPending = (sessionID: string) => {
    batch(() => {
      setPendingUI("stopProjectedAtUserMessage", sessionID, latestUserMessageID(sessionID) ?? null)
      setPendingUI("stopProjected", sessionID, true)
    })
    return () => {
      batch(() => {
        setPendingUI("stopProjected", sessionID, undefined)
        setPendingUI("stopProjectedAtUserMessage", sessionID, undefined)
      })
    }
  }

  const beginOptimisticStop = (sessionID: string) => {
    const rollback = optimisticStopPending(sessionID)
    void refreshPending(sessionID, { force: true })
    return rollback
  }

  const stopSession = async (sessionID: string) => {
    if (!busy(sessionID)) return
    const rollback = beginOptimisticStop(sessionID)
    try {
      await sdk.client.session.stop({ sessionID })
      await refreshSessionStatus()
      await refreshPending(sessionID, { force: true, supersede: true })
    } catch (error) {
      throw error
    } finally {
      rollback()
    }
  }

  createEffect(
    on(
      () => {
        const sessionID = params.id
        if (!sessionID) return undefined
        const pending = sync.data.session_pending[sessionID]
        return [
          sessionID,
          pendingUI.stopProjected[sessionID],
          sync.data.session_status[sessionID]?.type,
          pending?.paused,
          pending?.stopRequested,
          pending?.steer.length ?? 0,
          pending?.queue.length ?? 0,
        ] as const
      },
      (state) => {
        if (!state) return
        const [sessionID, _stopProjected, status, paused, stopRequested, steerCount, queueCount] = state
        if (status !== "busy" || !paused || stopRequested) return
        if (steerCount === 0 && queueCount === 0) return
        void refreshSessionStatus()
        void refreshPending(sessionID, { force: true, background: true })
      },
      { defer: true },
    ),
  )

  const prepareHistoryMutation = async (sessionID: string) => {
    if (!busy(sessionID)) return
    await stopSession(sessionID)
    const refreshResult = await refreshPending(sessionID, { force: true, supersede: true })
    if (refreshResult !== "applied" || !pendingStateFresh(sessionID)) {
      throw new Error("pending refresh failed before history mutation")
    }
    const pending = rawPendingState(sessionID)
    if (pending.paused && pending.steer.length === 0 && pending.queue.length === 0) {
      await mutatePending(sessionID, undefined, () => sdk.client.session.pendingResume({ sessionID }), {
        throwOnError: true,
      })
    }
  }

  const pendingReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    return pendingStateFresh(id)
  })

  const composerHasDraft = createMemo(() => {
    const text = prompt
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
      .trim()
    return (
      text.length > 0 ||
      prompt.current().some((part) => part.type === "image") ||
      prompt.context.items().length > 0 ||
      comments.all().length > 0
    )
  })

  const withHistoryMutation = async <T,>(sessionID: string, task: () => Promise<T>) => {
    if (pendingUI.historyMutating[sessionID]) {
      throw new Error("history mutation already in progress")
    }
    setPendingUI("historyMutating", sessionID, true)
    try {
      return await task()
    } finally {
      setPendingUI("historyMutating", sessionID, undefined)
    }
  }

  const haltForHistoryMutation = (sessionID: string) => prepareHistoryMutation(sessionID)

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const prev = prompt.current().slice()
      const prevContext = prompt.context.items().slice()
      const prevComments = comments.all().slice()
      const last = info()?.revert
      await withHistoryMutation(input.sessionID, async () => {
        await haltForHistoryMutation(input.sessionID)
        batch(() => {
          roll(input.sessionID, { messageID: input.messageID })
          restoreHistoryComposer(input.messageID)
        })
        try {
          const result = await sdk.client.session.revert(input)
          if (result.error) {
            if (isPendingConflictError(result.error)) {
              await invalidatePending(input.sessionID)
            }
            throw result.error
          }
          if (result.data) merge(result.data)
          if (params.id === input.sessionID) {
            setActiveMessage(findLast(userMessages(), (item) => item.id < input.messageID))
          }
        } catch (err) {
          if (isPendingConflictError(err)) {
            await invalidatePending(input.sessionID)
          }
          roll(input.sessionID, last)
          if (params.id === input.sessionID) {
            batch(() => {
              clearPromptContext()
              comments.replace(prevComments)
              restorePromptContext(prevContext)
              prompt.set(prev)
            })
          }
          fail(err)
        }
      })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const sessionID = params.id
      if (!sessionID) return
      try {
        await withHistoryMutation(sessionID, async () => {
          await haltForHistoryMutation(sessionID)
          await ensureRevertBoundaryLoaded(sessionID)
          if (params.id !== sessionID) return

          const next = userMessages().find((item) => item.id > id)
          const prev = prompt.current().slice()
          const prevContext = prompt.context.items().slice()
          const prevComments = comments.all().slice()
          const last = info()?.revert

          try {
            batch(() => {
              roll(sessionID, next ? { messageID: next.id } : undefined)
              restoreHistoryComposer(next?.id)
            })
            const result = !next
              ? await sdk.client.session.unrevert({ sessionID })
              : await sdk.client.session.revert({
                  sessionID,
                  messageID: next.id,
                })
            if (result.error) {
              if (isPendingConflictError(result.error)) {
                await invalidatePending(sessionID)
              }
              throw result.error
            }
            if (result.data) merge(result.data)
            if (params.id === sessionID) {
              setActiveMessage(
                !next
                  ? findLast(userMessages(), (item) => !last?.messageID || item.id >= last.messageID)
                  : findLast(userMessages(), (item) => item.id < next.id),
              )
            }
          } catch (err) {
            if (isPendingConflictError(err)) {
              await invalidatePending(sessionID)
            }
            roll(sessionID, last)
            if (params.id === sessionID) {
              batch(() => {
                clearPromptContext()
                comments.replace(prevComments)
                restorePromptContext(prevContext)
                prompt.set(prev)
              })
            }
            fail(err)
          }
        })
      } catch (error) {
        fail(error)
      }
    },
  }))

  const reverting = createMemo(() => {
    const sessionID = params.id
    return (
      revertMutation.isPending || restoreMutation.isPending || (!!sessionID && !!pendingUI.historyMutating[sessionID])
    )
  })
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const pendingControllerInput = (sessionID = params.id) => {
    const existingSession = !!sessionID
    const runtime = sessionID && busy(sessionID) ? "busy" : "idle"
    return {
      existingSession,
      runtime,
      preferredFollowupLane: settings.general.followup(),
      pendingKnowledge: existingSession && !pendingStateFresh(sessionID) ? "unknown" : "known",
      pending: sessionID ? rawPendingState(sessionID) : emptyPending,
      localEditID: sessionID ? pendingUI.localEdit[sessionID] : undefined,
      composerHasDraft: composerHasDraft(),
      refreshInFlight: sessionID ? !!pendingUI.loading[sessionID] : false,
      followupMutationInFlight: sessionID ? !!pendingUI.mutating[sessionID] : false,
      historyMutationInFlight: sessionID ? !!pendingUI.historyMutating[sessionID] : false,
      stopProjectionActive: sessionID ? !!pendingUI.stopProjected[sessionID] : false,
    } as const
  }

  const pendingRowActionInput = (sessionID = params.id) => ({
    ...pendingControllerInput(sessionID),
    followupMutationInFlight: false,
  })

  const pendingController = createMemo(() => derivePendingControllerState(pendingControllerInput()))
  const pendingControllerState = () => pendingController() ?? derivePendingControllerState(pendingControllerInput())
  const visiblePendingEditingID = createMemo(() => getVisibleEditingItemID(pendingControllerInput()))

  const historyMutationBlocked = createMemo(() => !!getHistoryMutationBlockReason(pendingControllerInput()))

  const blockedReasonText = (reason?: ReturnType<typeof getQueueSubmitBlockReason>, context?: "submit") => {
    if (!reason) return
    switch (reason) {
      case "editing_in_progress":
      case "editing_requires_empty_composer":
        return language.t("session.followupDock.editingBlocked")
      default:
        if (context === "submit") return language.t("session.followupDock.pendingSubmitBlocked")
        return language.t("session.followupDock.pendingBlocked")
    }
  }

  const submitBlockedReason = createMemo(() => blockedReasonText(pendingControllerState().submitBlockedReason, "submit"))
  const editSubmitBlockedReason = createMemo(() => blockedReasonText(getEditSaveBlockReason(pendingControllerInput())))
  const editCancelBlockedReason = createMemo(() =>
    blockedReasonText(getEditCancelBlockReason(pendingControllerInput())),
  )

  useSessionCommands({
    navigateMessageByOffset,
    setActiveMessage,
    focusInput,
    stopSession,
    prepareHistoryMutation,
    fail,
    mergeSession: merge,
    review: reviewTab,
    historyMutationBlocked,
    runHistoryMutation: withHistoryMutation,
    ensureRevertBoundaryLoaded,
    ensureUndoBoundaryLoaded,
    invalidatePending,
    busy,
    restoreHistoryComposer,
  })

  const editingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    const editID = visiblePendingEditingID()
    if (!editID) return
    const item = pendingItemByID(id, editID)
    if (!item) return
    const draft = fromPendingDraft({
      draft: item.draft,
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })
    return {
      id: item.id,
      prompt: draft.prompt,
      context: draft.context,
      agent: draft.agent,
      model: draft.model,
      variant: draft.variant,
      baseDraft: item.draft,
    }
  })

  createEffect(() => {
    const id = params.id
    if (!id) return
    const localEdit = pendingUI.localEdit[id]
    if (!localEdit) return
    if (!pendingStateFresh(id)) return
    if (pendingItemByID(id, localEdit)) return
    setPendingUI("localEdit", id, undefined)
  })

  const queueEnabled = createMemo(() => {
    if (!params.id || isChildSession() || composer.blocked()) return false
    return pendingControllerState().canQueueSubmit
  })

  const steerEnabled = createMemo(() => {
    if (!params.id || isChildSession() || composer.blocked()) return false
    return pendingControllerState().canSteerSubmit
  })

  const followupOverrideKey = (event: Event) =>
    event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey

  const followupLane = (event: Event): "queue" | "steer" | undefined => {
    return resolveFollowupLane({
      primaryFollowupLane: pendingControllerState().primaryFollowupLane,
      override: followupOverrideKey(event),
      canQueueSubmit: queueEnabled(),
      canSteerSubmit: steerEnabled(),
    })
  }

  const queueFollowup = (draft: FollowupDraft) =>
    mutatePending(
      draft.sessionID,
      getQueueSubmitBlockReason(pendingControllerInput(draft.sessionID)),
      () =>
        sdk.client.session.pendingAdd({
          sessionID: draft.sessionID,
          lane: "queue",
          draft: toPendingDraft({
            draft,
            commandNames: sync.data.command.map((item) => item.name),
            attachmentName: language.t("common.attachment"),
          }),
        }),
      { throwOnError: true },
    )

  const steerFollowup = async (draft: FollowupDraft) => {
    const directory = currentPendingDirectory()
    try {
      return await mutatePending(
        draft.sessionID,
        getSteerSubmitBlockReason(pendingControllerInput(draft.sessionID)),
        () =>
          sdk.client.session.pendingAdd({
            sessionID: draft.sessionID,
            lane: "steer",
            draft: toPendingDraft({
              draft,
              commandNames: sync.data.command.map((item) => item.name),
              attachmentName: language.t("common.attachment"),
            }),
          }),
        { throwOnError: true, suppressError: isSteerUnavailableError, directory },
      )
    } catch (err) {
      if (!isSteerUnavailableError(err)) throw err
      await invalidatePending(draft.sessionID, { directory })?.catch(() => {})
      return pendingCoordinator.blocked(draft.sessionID, "cannot_steer_now", { directory })
    }
  }

  const movePendingUp = (itemID: string) => {
    const sessionID = params.id
    if (!sessionID) return
    return enqueuePendingRowAction(sessionID, () =>
      mutatePending(sessionID, getPendingItemActionBlockReason(pendingRowActionInput(sessionID)), () =>
        sdk.client.session.pendingMoveUp({ sessionID, itemID }),
      ),
    )
  }

  const movePendingDown = (itemID: string) => {
    const sessionID = params.id
    if (!sessionID) return
    return enqueuePendingRowAction(sessionID, () =>
      mutatePending(sessionID, getPendingItemActionBlockReason(pendingRowActionInput(sessionID)), () =>
        sdk.client.session.pendingMoveDown({ sessionID, itemID }),
      ),
    )
  }

  const movePending = (itemID: string, lane: "steer" | "queue") => {
    const sessionID = params.id
    if (!sessionID) return
    return enqueuePendingRowAction(sessionID, () => {
      const directory = currentPendingDirectory()
      const input = pendingRowActionInput(sessionID)
      const blockReason = getPendingMoveLaneBlockReason(input, lane)
      const moveOptions: PendingMutationOptions =
        lane === "steer"
          ? {
              throwOnError: true,
              suppressError: isSteerUnavailableError,
              directory,
            }
          : { directory }
      return mutatePending(
        sessionID,
        blockReason,
        () => sdk.client.session.pendingMoveLane({ sessionID, itemID, lane }),
        moveOptions,
      ).catch((err) => {
        if (lane === "steer" && isSteerUnavailableError(err)) {
          void invalidatePending(sessionID, { directory })
          return pendingCoordinator.blocked(sessionID, "cannot_steer_now", { directory })
        }
        throw err
      })
    })
  }

  const deletePending = async (itemID: string) => {
    const sessionID = params.id
    if (!sessionID) return
    const next = await enqueuePendingRowAction(sessionID, () =>
      mutatePending(sessionID, getPendingItemActionBlockReason(pendingRowActionInput(sessionID)), () =>
        sdk.client.session.pendingDelete({ sessionID, itemID }),
      ),
    )
    if (next.kind === "applied" && pendingUI.localEdit[sessionID] === itemID) {
      setPendingUI("localEdit", sessionID, undefined)
    }
    return next
  }

  const editFollowup = async (itemID: string) => {
    const sessionID = params.id
    if (!sessionID) return
    return enqueuePendingRowAction(sessionID, () => startEditingFollowup(sessionID, itemID))
  }

  const startEditingFollowup = async (sessionID: string, itemID: string) => {
    const directory = currentPendingDirectory()

    const startLocalEdit = (): PendingBlockReason | undefined => {
      const blockReason = getStartEditBlockReason(pendingRowActionInput(sessionID))
      if (blockReason) return blockReason
      if (!pendingItemByID(sessionID, itemID)) return "blocked_by_pending"
      setPendingUI("localEdit", sessionID, itemID)
      return undefined
    }

    let blockReason = startLocalEdit()
    if (!blockReason) {
      return {
        kind: "applied" as const,
        state: rawPendingState(sessionID),
      }
    }
    if (blockReason !== "pending_unknown" && blockReason !== "blocked_by_pending") {
      return blockPending(sessionID, blockReason, directory)
    }

    const refreshResult = await refreshPending(sessionID, {
      force: true,
      supersede: true,
      directory,
      background: true,
    })
    if (refreshResult !== "applied") {
      return pendingCoordinator.blocked(sessionID, "blocked_by_pending", { directory })
    }

    blockReason = startLocalEdit()
    if (blockReason) {
      if (blockReason === "blocked_by_pending") setPendingUI("localEdit", sessionID, undefined)
      return blockPending(sessionID, blockReason, directory)
    }

    if (!pendingItemByID(sessionID, itemID)) {
      setPendingUI("localEdit", sessionID, undefined)
      return pendingCoordinator.blocked(sessionID, "blocked_by_pending", { directory })
    }

    return {
      kind: "applied" as const,
      state: rawPendingState(sessionID),
    }
  }

  const commitFollowupEdit = async (draft: FollowupDraft) => {
    const sessionID = params.id
    const itemID = visiblePendingEditingID()
    const directory = currentPendingDirectory()
    if (!sessionID || !itemID) return pendingCoordinator.blocked(draft.sessionID, "blocked_by_pending", { directory })
    try {
      const next = await mutatePending(
        sessionID,
        getEditSaveBlockReason(pendingControllerInput(sessionID)),
        () =>
          sdk.client.session.pendingEditCommit({
            sessionID,
            itemID,
            draft: toPendingDraft({
              draft,
              commandNames: sync.data.command.map((item) => item.name),
              attachmentName: language.t("common.attachment"),
            }),
          }),
        { throwOnError: true, suppressError: isPendingConflictError, directory },
      )
      if (next.kind === "applied") {
        setPendingUI("localEdit", sessionID, undefined)
      }
      return next
    } catch (err) {
      if (!isPendingConflictError(err)) throw err
      setPendingUI("localEdit", sessionID, undefined)
      void invalidatePending(sessionID, { directory })
      return pendingCoordinator.blocked(sessionID, "blocked_by_pending", { directory })
    }
  }

  const cancelFollowupEdit = async () => {
    const sessionID = params.id
    if (!sessionID || !pendingUI.localEdit[sessionID]) return blockPending(params.id ?? "", "blocked_by_pending")
    const blockReason = getEditCancelBlockReason(pendingControllerInput(sessionID))
    if (blockReason) return blockPending(sessionID, blockReason)
    setPendingUI("localEdit", sessionID, undefined)
    return {
      kind: "applied" as const,
      state: rawPendingState(sessionID),
    }
  }

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting() || historyMutationBlocked()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!params.id || reverting() || historyMutationBlocked()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const actions = createMemo(() => (historyMutationBlocked() ? undefined : { revert }))

  const resumePending = () => {
    const sessionID = params.id
    if (!sessionID) return
    return mutatePending(sessionID, getResumeBlockReason(pendingControllerInput(sessionID)), () =>
      sdk.client.session.pendingResume({ sessionID }),
    )
  }

  const pendingStopProjected = createMemo(() => pendingControllerState().projectionAxis === "stopProjected")
  const pendingDockPaused = createMemo(() => {
    const controller = pendingControllerState()
    return (
      controller.pendingShape !== "empty" &&
      (controller.effectivePending?.paused ?? false) &&
      !controller.canSteerSubmit
    )
  })

  const pendingDockLoading = createMemo(() => {
    const controller = pendingControllerState()
    return (
      controller.pendingKnowledge === "unknown" ||
      controller.networkAxis === "mutating" ||
      (controller.networkAxis === "historyMutating" && controller.pendingShape !== "empty")
    )
  })

  const pendingRows = (lane: "steer" | "queue", items: SessionPendingItem[]) => {
    const queuedActionInput = pendingRowActionInput()
    const editingID = visiblePendingEditingID()
    const controller = pendingControllerState()
    const locked = controller.pendingKnowledge === "unknown" || controller.networkAxis === "historyMutating"
    const reorderLocked = locked || controller.projectionAxis === "stopProjected"

    return items.map((item, index) => {
      const moveReason = getPendingItemActionBlockReason(queuedActionInput)
      const moveLaneReason = getPendingMoveLaneBlockReason(queuedActionInput, lane === "steer" ? "queue" : "steer")
      const editReason = getStartEditBlockReason(queuedActionInput)
      const deleteReason = getPendingItemActionBlockReason(queuedActionInput)
      return {
        id: item.id,
        text: item.draft.preview,
        editing: editingID === item.id,
        disableUp: reorderLocked || !!moveReason || index === 0,
        disableDown: reorderLocked || !!moveReason || index === items.length - 1,
        disableMoveLane: locked || !!moveLaneReason,
        disableEdit: !!editReason,
        editHint:
          editReason === "editing_requires_empty_composer"
            ? language.t("session.followupDock.editDisabledDraft")
            : undefined,
        disableDelete: locked || !!deleteReason,
      }
    })
  }

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const stick = el
        ? !autoScroll.userScrolled() || el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta)
        : false

      dockHeight = next

      if (stick) autoScroll.forceScrollToBottom()

      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey,
    sessionID: () => params.id,
    messagesReady,
    loadedUserMessages: userMessages,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    turnStart: historyWindow.turnStart,
    currentMessageId: () => store.messageId,
    pendingMessage: () => ui.pendingMessage,
    setPendingMessage: (value) => setUi("pendingMessage", value),
    setActiveMessage,
    setTurnStart: historyWindow.setTurnStart,
    autoScroll,
    scroller: () => scroller,
    anchor,
    scheduleScrollState,
    consumePendingMessage: layout.pendingMessage.consume,
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) requestAnimationFrame(() => inputRef?.focus())
      },
    ),
  )

  onMount(() => {
    makeEventListener(document, "keydown", handleKeyDown)
  })

  onCleanup(() => {
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
    if (todoTimer !== undefined) window.clearTimeout(todoTimer)
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
  })

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
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
                    actions={actions()}
                    scroll={ui.scroll}
                    onResumeScroll={resumeScroll}
                    setScrollRef={setScrollRef}
                    onScheduleScrollState={scheduleScrollState}
                    onAutoScrollHandleScroll={autoScroll.handleScroll}
                    onMarkScrollGesture={markScrollGesture}
                    hasScrollGesture={hasScrollGesture}
                    onUserScroll={markUserScroll}
                    onTurnBackfillScroll={historyWindow.onScrollerScroll}
                    onAutoScrollInteraction={autoScroll.handleInteraction}
                    centered={centered()}
                    setContentRef={(el) => {
                      content = el
                      autoScroll.contentRef(el)

                      const root = scroller
                      if (root) scheduleScrollState(root)
                    }}
                    turnStart={historyWindow.turnStart()}
                    historyMore={historyMore()}
                    historyLoading={historyLoading()}
                    onLoadEarlier={() => {
                      void historyWindow.loadAndReveal()
                    }}
                    renderedUserMessages={historyWindow.renderedUserMessages()}
                    anchor={anchor}
                  />
                </Show>
              </Match>
              <Match when={true}>
                <NewSessionView worktree={newSessionWorktree()} />
              </Match>
            </Switch>
          </div>

          <SessionComposerRegion
            state={composer}
            ready={!store.deferRender && messagesReady()}
            centered={centered()}
            inputRef={(el) => {
              inputRef = el
            }}
            newSessionWorktree={newSessionWorktree()}
            onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
            onSubmit={() => {
              comments.clear()
              resumeScroll()
            }}
            onResponseSubmit={resumeScroll}
            followup={
              params.id && !isChildSession()
                ? {
                    lane: followupLane,
                    pending: {
                      ready: pendingReady(),
                      paused: pendingDockPaused(),
                      stopProjected: pendingStopProjected(),
                      editing: !!visiblePendingEditingID(),
                      canResume: pendingControllerState().canResume,
                      loading: pendingDockLoading(),
                      steer: pendingRows("steer", pendingControllerState().effectivePending?.steer ?? []),
                      queue: pendingRows("queue", pendingControllerState().effectivePending?.queue ?? []),
                      onResume: () => {
                        void resumePending()
                      },
                      onMoveUp: (id) => {
                        void movePendingUp(id)
                      },
                      onMoveDown: (id) => {
                        void movePendingDown(id)
                      },
                      onMoveLane: (id, lane) => {
                        void movePending(id, lane)
                      },
                      onEdit: (id) => {
                        void editFollowup(id)
                      },
                      onDelete: (id) => {
                        void deletePending(id)
                      },
                    },
                    editingID: visiblePendingEditingID(),
                    edit: editingFollowup(),
                    submitBlockedReason: submitBlockedReason(),
                    editSubmitBlockedReason: editSubmitBlockedReason(),
                    editCancelBlockedReason: editCancelBlockedReason(),
                    followupEnabled:
                      pendingControllerState().canQueueSubmit || pendingControllerState().canSteerSubmit,
                    onQueue: queueFollowup,
                    onSteer: steerFollowup,
                    onAbort: () => {
                      if (!params.id) return
                      return beginOptimisticStop(params.id)
                    },
                    onEditCancel: cancelFollowupEdit,
                    onEditSubmit: commitFollowupEdit,
                  }
                : undefined
            }
            revert={
              rolled().length > 0
                ? {
                    items: rolled(),
                    restoring: restoring(),
                    disabled: reverting() || historyMutationBlocked(),
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
