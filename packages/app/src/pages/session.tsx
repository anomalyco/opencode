import { onCleanup, Show, Match, Switch, createMemo, createEffect, on, onMount } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { createStore } from "solid-js/store"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Select } from "@opencode-ai/ui/select"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { Mark } from "@opencode-ai/ui/logo"

import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { checksum, base64Encode } from "@opencode-ai/util/encode"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useNavigate, useParams } from "@solidjs/router"
import { UserMessage } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { useComments } from "@/context/comments"
import { SessionHeader, NewSessionView } from "@/components/session"
import { same } from "@/utils/same"
import { createOpenReviewFile } from "@/pages/session/helpers"
import { createScrollSpy } from "@/pages/session/scroll-spy"
import { SessionReviewTab, type DiffStyle, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { SessionComposerRegion, createSessionComposerState } from "@/pages/session/composer"
import { SessionMobileTabs } from "@/pages/session/session-mobile-tabs"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"

export default function Page() {
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const prompt = usePrompt()
  const comments = useComments()

  const [ui, setUi] = createStore({
    pendingMessage: undefined as string | undefined,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
    },
  })

  const composer = createSessionComposerState()

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const workspaceKey = createMemo(() => params.dir ?? "")
  const workspaceTabs = createMemo(() => layout.tabs(workspaceKey))
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))

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
    messageId: undefined as string | undefined,
    turnStart: 0,
    mobileTab: "session" as "session" | "changes",
    changes: "session" as "session" | "turn",
    newSessionWorktree: "main",
  })

  const turnDiffs = createMemo(() => lastUserMessage()?.summary?.diffs ?? [])
  const reviewDiffs = createMemo(() => (store.changes === "session" ? diffs() : turnDiffs()))

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
    if (project && sdk.directory !== project.worktree) return sdk.directory
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

    const current = store.messageId
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

  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasReview()) return true
    return sync.data.session_diff[id] !== undefined
  })
  const reviewEmptyKey = createMemo(() => {
    const project = sync.project
    if (!project || project.vcs) return "session.review.empty"
    return "session.review.noVcs"
  })

  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined

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

  createEffect(() => {
    sdk.directory
    const id = params.id
    if (!id) return
    void sync.session.sync(id)
    void sync.session.todo(id)
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
        setStore("changes", "session")
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

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    const start = Math.max(1, Math.min(selection.startLine, selection.endLine))
    const end = Math.max(selection.startLine, selection.endLine)
    const lines = content.split("\n").slice(start - 1, end)
    if (lines.length === 0) return undefined
    return lines.slice(0, 2).join("\n")
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

    // Don't autofocus chat if desktop terminal panel is open
    if (isDesktop() && view().terminal.opened()) return

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

  const contextOpen = createMemo(() => tabs().active() === "context" || tabs().all().includes("context"))
  const openedTabs = createMemo(() =>
    tabs()
      .all()
      .filter((tab) => tab !== "context" && tab !== "review"),
  )

  const mobileChanges = createMemo(() => !isDesktop() && store.mobileTab === "changes")
  const reviewTab = createMemo(() => isDesktop())

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
        setTree({ reviewScroll: undefined, pendingDiff: undefined, activeDiff: undefined })
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
  })

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: tabs().open,
    loadFile: file.load,
  })

  const changesOptions = ["session", "turn"] as const
  const changesOptionsList = [...changesOptions]

  const changesTitle = () => (
    <Select
      options={changesOptionsList}
      current={store.changes}
      label={(option) =>
        option === "session" ? language.t("ui.sessionReview.title") : language.t("ui.sessionReview.title.lastTurn")
      }
      onSelect={(option) => option && setStore("changes", option)}
      variant="ghost"
      size="small"
      valueClass="text-14-medium"
    />
  )

  const emptyTurn = () => (
    <div class="h-full pb-30 flex flex-col items-center justify-center text-center gap-6">
      <Mark class="w-14 opacity-10" />
      <div class="text-14-regular text-text-weak max-w-56">{language.t("session.review.noChanges")}</div>
    </div>
  )

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <Switch>
      <Match when={store.changes === "turn" && !!params.id}>
        <SessionReviewTab
          title={changesTitle()}
          empty={emptyTurn()}
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
      </Match>
      <Match when={hasReview()}>
        <Show
          when={diffsReady()}
          fallback={<div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>}
        >
          <SessionReviewTab
            title={changesTitle()}
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
      </Match>
      <Match when={true}>
        <SessionReviewTab
          title={changesTitle()}
          empty={
            store.changes === "turn" ? (
              emptyTurn()
            ) : (
              <div class={input.emptyClass}>
                <Mark class="w-14 opacity-10" />
                <div class="text-14-regular text-text-weak max-w-56">{language.t(reviewEmptyKey())}</div>
              </div>
            )
          }
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
      </Match>
    </Switch>
  )

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-30 flex flex-col items-center justify-center text-center gap-6",
        })}
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
    const current = view().review.open() ?? []
    if (!current.includes(path)) view().review.setOpen([...current, path])
    setTree({ activeDiff: path, pendingDiff: path })
  }

  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!diffsReady()) return

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
        }
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const id = params.id
    if (!id) return

    const wants = isDesktop()
      ? desktopFileTreeOpen() || (desktopReviewOpen() && activeTab() === "review")
      : store.mobileTab === "changes"
    if (!wants) return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return

    void sync.session.diff(id)
  })

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
        void file.tree.list("")

        const active = tabs().active()
        if (!active) return
        const path = file.pathFromTab(active)
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
  const scrollSpy = createScrollSpy({
    onActive: (id) => {
      if (id === store.messageId) return
      setStore("messageId", id)
    },
  })

  const updateScrollState = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight
    const overflow = max > 1
    const bottom = !overflow || el.scrollTop >= max - 2

    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom) return
    setUi("scroll", { overflow, bottom })
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

  createEffect(
    on(
      sessionKey,
      () => {
        scrollSpy.clear()
      },
      { defer: true },
    ),
  )

  const anchor = (id: string) => `message-${id}`

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    scrollSpy.setContainer(el)
    if (el) scheduleScrollState(el)
  }

  createResizeObserver(
    () => content,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el)
      scrollSpy.markDirty()
    },
  )

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

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const stick = el ? el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta) : false

      dockHeight = next

      if (stick) autoScroll.forceScrollToBottom()

      if (el) scheduleScrollState(el)
      scrollSpy.markDirty()
    },
  )

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey,
    sessionID: () => params.id,
    messagesReady,
    visibleUserMessages,
    turnStart: () => store.turnStart,
    currentMessageId: () => store.messageId,
    pendingMessage: () => ui.pendingMessage,
    setPendingMessage: (value) => setUi("pendingMessage", value),
    setActiveMessage,
    setTurnStart: (value) => setStore("turnStart", value),
    scheduleTurnBackfill,
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
    cancelTurnBackfill()
    document.removeEventListener("keydown", handleKeyDown)
    scrollSpy.destroy()
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
  })

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
      <SessionHeader />
      <div class="flex-1 min-h-0 flex flex-col md:flex-row">
        <SessionMobileTabs
          open={!isDesktop() && !!params.id}
          mobileTab={store.mobileTab}
          hasReview={hasReview()}
          reviewCount={reviewCount()}
          onSession={() => setStore("mobileTab", "session")}
          onChanges={() => setStore("mobileTab", "changes")}
        />

        {/* Session panel */}
        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger": true,
            "flex-1": true,
            "md:flex-none": desktopSidePanelOpen(),
          }}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id}>
                <Show when={activeMessage()}>
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
                      emptyClass: "h-full pb-30 flex flex-col items-center justify-center text-center gap-6",
                    })}
                    scroll={ui.scroll}
                    onResumeScroll={resumeScroll}
                    setScrollRef={setScrollRef}
                    onScheduleScrollState={scheduleScrollState}
                    onAutoScrollHandleScroll={autoScroll.handleScroll}
                    onMarkScrollGesture={markScrollGesture}
                    hasScrollGesture={hasScrollGesture}
                    isDesktop={isDesktop()}
                    onScrollSpyScroll={scrollSpy.onScroll}
                    onAutoScrollInteraction={autoScroll.handleInteraction}
                    centered={centered()}
                    setContentRef={(el) => {
                      content = el
                      autoScroll.contentRef(el)

                      const root = scroller
                      if (root) scheduleScrollState(root)
                    }}
                    turnStart={store.turnStart}
                    onRenderEarlier={() => setStore("turnStart", 0)}
                    historyMore={historyMore()}
                    historyLoading={historyLoading()}
                    onLoadEarlier={() => {
                      const id = params.id
                      if (!id) return
                      setStore("turnStart", 0)
                      sync.session.history.loadMore(id)
                    }}
                    renderedUserMessages={renderedUserMessages()}
                    anchor={anchor}
                    onRegisterMessage={scrollSpy.register}
                    onUnregisterMessage={scrollSpy.unregister}
                    lastUserMessageID={lastUserMessage()?.id}
                  />
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
                    if (target === sdk.directory) return
                    layout.projects.open(target)
                    navigate(`/${base64Encode(target)}/session`)
                  }}
                />
              </Match>
            </Switch>
          </div>

          <SessionComposerRegion
            state={composer}
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
            setPromptDockRef={(el) => {
              promptDock = el
            }}
          />

          <Show when={desktopReviewOpen()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.session.width()}
              min={450}
              max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.45}
              onResize={layout.session.resize}
            />
          </Show>
        </div>

        <SessionSidePanel reviewPanel={reviewPanel} activeDiff={tree.activeDiff} focusReviewDiff={focusReviewDiff} />
      </div>

      <TerminalPanel />
    </div>
  )
}
