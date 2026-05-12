import type { Project, UserMessage } from "@opencode-ai/sdk/v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createQuery, skipToken, useMutation, useQueryClient } from "@tanstack/solid-query"
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
  createResource,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { debounce } from "@solid-primitives/scheduled"
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
import { base64Encode, checksum } from "@opencode-ai/util/encode"
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
import { shouldUseV2NewSessionPage } from "@/pages/session/new-session-layout"
import { Identifier } from "@/utils/id"
import { diffs as list } from "@/utils/diffs"
import { Persist, persisted } from "@/utils/persist"
import { extractPromptFromParts } from "@/utils/prompt"
import { same } from "@/utils/same"
import { formatServerError } from "@/utils/server-errors"
import { useUsageExceededDialogs } from "./session/usage-exceeded-dialogs"

const emptyUserMessages: UserMessage[] = []
const scrollBottomThreshold = 16
const settleMs = 1_500
const emptyFollowups: (FollowupDraft & { id: string })[] = []

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
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const language = useLanguage()
  const settings = useSettings()
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const sdk = useSDK()
  const settings = useSettings()
  const sessionHistory = useSessionHistory()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const location = useLocation()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  const request = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return
    const next = sync.data.permission[sessionID]?.[0]
    if (!next) return
    if (next.tool) return
    return next
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
  const isV2NewSessionPage = () =>
    shouldUseV2NewSessionPage({ channel: import.meta.env.VITE_OPENCODE_CHANNEL, sessionID: params.id })
  const desktopReviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened() && !isV2NewSessionPage())
  const desktopFileTreeOpen = createMemo(() => isDesktop() && layout.fileTree.opened() && !isV2NewSessionPage())
  const desktopSidePanelOpen = createMemo(() => desktopReviewOpen() || desktopFileTreeOpen())
  const sessionPanelWidth = createMemo(() => {
    if (!desktopSidePanelOpen()) return "100%"
    if (desktopReviewOpen()) return `${layout.session.width()}px`
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const centered = createMemo(() => isDesktop() && !desktopReviewOpen())

  // Content width using CSS variable (decoupled from centering logic)
  const contentWidthClasses = createMemo(() => {
    // Always apply max-width constraint; only toggle centering based on centered()
    return centered()
      ? "md:max-w-[var(--session-content-width)] md:mx-auto w-full"
      : "md:max-w-[var(--session-content-width)] w-full"
  })

  // Content width classes without mx-auto (for message containers)
  const contentWidthClassesNoCenter = createMemo(() => {
    return "md:max-w-[var(--session-content-width)]"
  })

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
    if (path) void file.load(path)
  })

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

  const [followup, setFollowup] = persisted(
    Persist.workspace(sdk.directory, "followup", ["followup.v1"]),
    createStore<{
      items: Record<string, FollowupItem[] | undefined>
      failed: Record<string, string | undefined>
      paused: Record<string, boolean | undefined>
      edit: Record<string, FollowupEdit | undefined>
    }>({
      items: {},
      failed: {},
      paused: {},
      edit: {},
    }),
  )

  let root: HTMLDivElement | undefined
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
    list.push("turn")
    return list
  })
  const mobileChanges = createMemo(() => !isDesktop() && store.mobileTab === "changes")
  const wantsReview = createMemo(() =>
    isDesktop()
      ? desktopFileTreeOpen() || (desktopReviewOpen() && activeTab() === "review")
      : store.mobileTab === "changes",
  )
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    if (store.changes === "git" || store.changes === "branch") return store.changes
  })
  const vcsKey = createMemo(
    () => ["session-vcs", sdk.directory, sync.data.vcs?.branch ?? "", sync.data.vcs?.default_branch ?? ""] as const,
  )
  const vcsQuery = createQuery(() => {
    const mode = vcsMode()
    const enabled = wantsReview() && sync.project?.vcs === "git"

    return {
      queryKey: [...vcsKey(), mode] as const,
      enabled,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 60 * 1000,
      queryFn: mode
        ? () =>
            sdk.client.vcs
              .diff({ mode })
              .then((result) => list(result.data))
              .catch((error) => {
                console.debug("[session-review] failed to load vcs diff", { mode, error })
                return []
              })
        : skipToken,
    }
  })
  const refreshVcs = debounce(() => void queryClient.invalidateQueries({ queryKey: vcsKey() }), 100)
  const reviewDiffs = () => {
    if (store.changes === "git" || store.changes === "branch")
      // avoids suspense
      return vcsQuery.isFetched ? (vcsQuery.data ?? []) : []
    return turnDiffs()
  }
  const reviewCount = () => reviewDiffs().length
  const hasReview = () => reviewCount() > 0
  const reviewReady = () => {
    if (store.changes === "git" || store.changes === "branch") return !vcsQuery.isPending
    return true
  }

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
  let revealMessage = (_id: string) => {}
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
            const info = getSessionPrefetch(directory, id)
            if (!info) return true
            return Date.now() - info.at > SESSION_PREFETCH_TTL
          })()

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

      return sync.session.sync(id)
    },
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
      () => params.dir,
      (dir) => {
        if (!dir) return
        setStore("newSessionWorktree", "main")
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const id = lastUserMessage()?.id
    if (!id) return
    setStore("expanded", id, status().type !== "idle")
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
      category: language.t("command.category.file"),
      keybind: "mod+p",
      slash: "open",
      onSelect: () => dialog.show(() => <DialogSelectFile onOpenFile={() => showAllFiles()} />),
    },
    {
      id: "tab.close",
      title: language.t("command.tab.close"),
      category: language.t("command.category.file"),
      keybind: "mod+w",
      disabled: !tabs().active(),
      onSelect: () => {
        const active = tabs().active()
        if (!active) return
        tabs().close(active)
      },
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

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
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
      id: "review.toggle",
      title: language.t("command.review.toggle"),
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
      id: "skill.list",
      title: language.t("command.skill.list"),
      description: language.t("command.skill.list.description"),
      category: language.t("command.category.skill"),
      keybind: "mod+shift+;",
      onSelect: () => dialog.show(() => <DialogSelectSkill />),
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
    {
      id: "input.focus",
      title: language.t("command.input.focus"),
      description: language.t("command.input.focus.description"),
      category: language.t("command.category.view"),
      keybind: "mod+slash",
      onSelect: () => {
        if (inputRef) {
          inputRef.focus()
        }
      },
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

  createEffect(() => {
    const list = changesOptions()
    if (list.includes(store.changes)) return
    const next = list[0]
    if (!next) return
    setStore("changes", next)
  })

  createEffect(
    on(
      () => sync.data.session_status[params.id ?? ""]?.type,
      (next, prev) => {
        if (next !== "idle" || prev === undefined || prev === "idle") return
        refreshVcs()
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

  useSessionCommands({
    command,
    dialog,
    file,
    language,
    local,
    permission,
    platform,
    prompt,
    server,
    sdk,
    sync,
    terminal,
    layout,
    params,
    navigate,
    tabs,
    view,
    info,
    status,
    userMessages,
    visibleUserMessages,
    activeMessage,
    showAllFiles,
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
      console.debug("[session] idle auto-scroll ignored")
      return
    }
    autoScroll.handleScroll()
  }

  // Streaming stability depends on locking the outer timeline directly to the
  // physical bottom. This avoids relying on the auto-scroll state machine once
  // content height is already changing every frame.
  const lockBottom = (el: HTMLDivElement, source: string) => {
    const next = Math.max(0, el.scrollHeight - el.clientHeight)
    const dist = next - el.scrollTop
    if (Math.abs(dist) <= 1) {
      debug("lock-bottom:skip", el, { source, dist: Math.round(dist) })
      return
    }
    el.scrollTop = next
    debug("lock-bottom:write", el, { source, dist: Math.round(dist) })
  }

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let fillFrame: number | undefined
  let initialScrollKey: string | undefined
  let initialScrollFrame: number | undefined
  let until = 0

  const hasScrollTarget = () => !!location.hash || !!ui.pendingMessage || !!ui.seekingMessageId || !!store.messageId
  const settling = () => !!initialScrollKey && performance.now() < until && !hasScrollGesture()

  const settle = (key: string) => {
    initialScrollFrame = undefined
    if (sessionKey() !== key) {
      initialScrollKey = undefined
      return
    }
    if (hasScrollTarget() || hasScrollGesture()) {
      initialScrollKey = undefined
      return
    }

    const root = scroller
    if (!root) {
      initialScrollKey = undefined
      return
    }

    const gap = Math.round(root.scrollHeight - root.clientHeight - root.scrollTop)
    if (Math.abs(gap) > 1) console.debug("[session] initial bottom settle", { gap })
    lockBottom(root, "initial-scroll:settle")
    scheduleScrollState(root)

    if (performance.now() >= until) {
      initialScrollKey = undefined
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
        lockBottom(root, "content:resize:lock-bottom")
      }
      debug("content-resize:after", root)
      scheduleScrollState(root)
    },
  )

  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)

  const updateScrollState = (el: HTMLDivElement) => {
    if (!el.isConnected || el.clientHeight <= 0 || el.scrollHeight <= 0) return
    debug("state:before", el)
    if ((live() || settling()) && !hasScrollGesture() && !hasScrollTarget()) {
      lockBottom(el, "state:live-lock")
    }
    const top = clamp(el)
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
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
    setStore("messageId", undefined)
    setUi("seekingMessageId", undefined)
    enterLive()
    autoScroll.forceScrollToBottom()
    clearMessageHash()

    const el = scroller
    if (el) scheduleScrollState(el)
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
        initialScrollFrame = requestAnimationFrame(() => {
          initialScrollFrame = requestAnimationFrame(() => {
            initialScrollFrame = undefined
            if (sessionKey() !== key) {
              initialScrollKey = undefined
              return
            }
            if (hasScrollTarget()) {
              console.debug(
                `[session] initial bottom skipped: key=${key} hash=${location.hash || "none"} pending=${ui.pendingMessage || "none"} seeking=${ui.seekingMessageId || "none"} current=${store.messageId || "none"}`,
              )
              initialScrollKey = undefined
              return
            }
            const el = scroller
            if (!el) {
              initialScrollKey = undefined
              return
            }
            debug("initial:before", el, { key })
            setStore("messageId", undefined)
            enterLive()
            clearMessageHash()
            until = performance.now() + settleMs
            lockBottom(el, "initial-scroll:bottom")
            scheduleScrollState(el)
            debug("initial:after", el, { key })
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
    debug("scroll-ref", el)
    scheduleScrollState(el)
    fill()
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
    return settings.general.followup() === "queue" && busy(id) && !composer.blocked() && !isChildSession()
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
    if (sync.session.get(sessionID)?.parentID) return Promise.resolve()
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

  const actions = { revert }

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return

    const item = queuedFollowups()[0]
    if (!item) return
    if (followupBusy(sessionID)) return
    if (followup.failed[sessionID] === item.id) return
    if (followup.paused[sessionID]) return
    if (isChildSession()) return
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
    revealMessage: (id) => revealMessage(id),
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
    if (initialScrollFrame !== undefined) cancelAnimationFrame(initialScrollFrame)
  })

  useUsageExceededDialogs()

  const composerRegion = (placement: "dock" | "inline") => (
    <SessionComposerRegion
      state={composer}
      ready={!store.deferRender && messagesReady()}
      centered={placement === "dock" && centered()}
      placement={placement}
      inputRef={(el) => {
        inputRef = el
      }}
      newSessionWorktree={newSessionWorktree()}
      onNewSessionWorktreeChange={(value) => setStore("newSessionWorktree", value)}
      onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
      onSubmit={() => {
        comments.clear()
        resumeScroll()
      }}
      onResponseSubmit={resumeScroll}
      followup={
        params.id && !isChildSession()
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
  )

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

        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger flex-1 md:flex-none": true,
            "duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
              !size.active() && !ui.reviewSnap,
            "transition-[width]": !isV2NewSessionPage(),
          }}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id && mobileChanges()}>
                <div class="relative h-full overflow-hidden">
                  {reviewContent({
                    diffStyle: "unified",
                    classes: {
                      root: "pb-8",
                      header: "px-4",
                      container: "px-4",
                    },
                    loadingClass: "px-4 py-4 text-text-weak",
                    emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
                  })}
                </div>
              </Match>
              <Match when={params.id}>
                <Show when={messagesReady()}>
                  <MessageTimeline
                    actions={actions}
                    scroll={ui.scroll}
                    live={live()}
                    onResumeScroll={resumeScroll}
                    setScrollRef={setScrollRef}
                    onScheduleScrollState={scheduleScrollState}
                    onAutoScrollHandleScroll={handleTimelineAutoScroll}
                    onMarkScrollGesture={markScrollGesture}
                    hasScrollGesture={hasScrollGesture}
                    onUserScroll={markUserScroll}
                    onAutoScrollInteraction={autoScroll.handleInteraction}
                    shouldAnchorBottom={() =>
                      !location.hash && !store.messageId && !ui.pendingMessage && !autoScroll.userScrolled()
                    }
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
