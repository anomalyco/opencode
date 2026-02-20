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
import { scrollTabIntoView } from "@/utils/dom"

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
      data-slot="sticky-add-button"
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
  const centered = createMemo(() => isDesktop() && !desktopSidePanelOpen())

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

  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasReview()) return true
    return sync.data.session_diff[id] !== undefined
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
  const reviewTab = createMemo(() => isDesktop() && !layout.fileTree.opened())

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
      size="large"
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
                <div class="text-14-regular text-text-weak max-w-56">{language.t("session.review.empty")}</div>
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
          return
        }

        if (fileTreeTab() !== "changes") return
        tabs().setActive("review")
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (fileTreeTab() !== "all") return

    const active = tabs().active()
    if (active && active !== "review") return

    const first = openedTabs()[0]
    if (first) {
      tabs().setActive(first)
      return
    }

    if (contextOpen()) tabs().setActive("context")
  })

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
      const stick = el ? el.scrollHeight - el.clientHeight - el.scrollTop < 10 : false

      dockHeight = next

      if (stick && el) {
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
        })
      }

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

        {/* Desktop side panel - hidden on mobile */}
        <Show when={isDesktop() && layout.fileTree.opened()}>
          <aside
            id="review-panel"
            aria-label={language.t("session.panel.reviewAndFiles")}
            class="relative flex-1 min-w-0 h-full border-l border-border-weak-base flex"
          >
            <div class="flex-1 min-w-0 h-full">
              <Show
                when={fileTreeTab() === "changes"}
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
                        <Tabs.List
                          ref={(el: HTMLDivElement) => {
                            let scrollTimeout: number | undefined
                            let prevScrollWidth = el.scrollWidth
                            let prevContextOpen = contextOpen()

                            const handler = () => {
                              if (scrollTimeout !== undefined) clearTimeout(scrollTimeout)
                              scrollTimeout = window.setTimeout(() => {
                                const scrollWidth = el.scrollWidth
                                const clientWidth = el.clientWidth
                                const currentContextOpen = contextOpen()

                                // Only scroll when a tab is added (width increased), not on removal
                                if (scrollWidth > prevScrollWidth) {
                                  if (!prevContextOpen && currentContextOpen) {
                                    // Context tab was opened, scroll to first
                                    el.scrollTo({
                                      left: 0,
                                      behavior: "smooth",
                                    })
                                  } else if (scrollWidth > clientWidth) {
                                    // File tab was added, scroll to rightmost
                                    el.scrollTo({
                                      left: scrollWidth - clientWidth,
                                      behavior: "smooth",
                                    })
                                  }
                                }
                                // When width decreases (tab removed), don't scroll - let browser handle it naturally

                                prevScrollWidth = scrollWidth
                                prevContextOpen = currentContextOpen
                              }, 0)
                            }

                            const wheelHandler = (e: WheelEvent) => {
                              // Enable horizontal scrolling with mouse wheel
                              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                                el.scrollLeft += e.deltaY > 0 ? 50 : -50
                                e.preventDefault()
                              }
                            }

                            el.addEventListener("wheel", wheelHandler, { passive: false })

                            const observer = new MutationObserver(handler)
                            observer.observe(el, { childList: true })

                            onCleanup(() => {
                              el.removeEventListener("wheel", wheelHandler)
                              observer.disconnect()
                              if (scrollTimeout !== undefined) clearTimeout(scrollTimeout)
                            })
                          }}
                        >
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
                              onClick={(e: MouseEvent) => scrollTabIntoView(e.currentTarget as HTMLElement)}
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
                          const isBinary = createMemo(() => state()?.content?.type === "binary")
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
                                <Match when={state()?.loaded && isBinary()}>
                                  <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center gap-6">
                                    <Mark class="w-14 opacity-10" />
                                    <div class="flex flex-col gap-2 max-w-md">
                                      <div class="text-14-semibold text-text-strong truncate">
                                        {path()?.split("/").pop()}
                                      </div>
                                      <div class="text-14-regular text-text-weak">
                                        {language.t("session.files.binaryContent")}
                                      </div>
                                    </div>
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

      <TerminalPanel />
    </div>
  )
}
