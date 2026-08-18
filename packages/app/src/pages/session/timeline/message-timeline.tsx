import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createVirtualizer, defaultRangeExtractor, elementScroll, type VirtualItem } from "@tanstack/solid-virtual"
import { Card } from "@opencode-ai/ui/card"
import { MessageDivider, SessionShellMessage, type UserActions } from "@opencode-ai/session-ui/message-part"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SessionRetry } from "@opencode-ai/session-ui/session-retry"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner, ScrollView } from "@opencode-ai/ui/scroll-view"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import type { Project } from "@/types"
import { getFilename } from "@opencode-ai/core/util/path"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useLanguage } from "@/context/language"
import { useData } from "@/context/server"
import { useWorkspaceLocation } from "@/context/location"
import { scheduleConnectedMeasure } from "./measure"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"
import { MessageComment, Timeline, TimelineRow, TimelineRowMap } from "./rows"
import { filterVirtualIndexes } from "./virtual-items"
import { createTimelineController, type TimelineController, type TimelineSessionSource } from "./controller"
import { containsDirectory, isWorkspaceDirectory, workspaceDirectories } from "@/utils/workspace"
import { SessionWorkspaceMenu } from "@/components/session-workspace-menu"
import { getProjectAvatarVariant } from "@/context/layout"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"
import {
  CurrentAssistantContent,
  CurrentContextToolGroup,
  CurrentUserMessage,
  currentPartDefaultOpen,
} from "./current-message"

const emptyAssistantMessages: SessionMessageAssistant[] = []

type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, { _tag: "TurnGap" }>
type TimelineRowByTag<T extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: T }>

const timelineFallbackItemSize = 60
const timelineCache = new Map<string, { measurements: VirtualItem[]; toolOpen: Record<string, boolean | undefined> }>()

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

function TimelineThinkingRow(props: { reasoningHeading?: string; showReasoningSummaries: boolean }) {
  const language = useLanguage()

  return (
    <div data-slot="session-turn-thinking">
      <TextShimmer text={language.t("ui.sessionTurn.status.thinking")} />
      <Show when={!props.showReasoningSummaries}>
        <TextReveal text={props.reasoningHeading} class="session-turn-thinking-heading" travel={25} duration={700} />
      </Show>
    </div>
  )
}

function WorkspaceMoveAction(props: {
  variant: "inline" | "panel"
  eligible: boolean
  sessionID: string
  project: Project
  directory: string
  dismissed: boolean
  onDismiss: () => void
}) {
  const language = useLanguage()
  const inline = () => props.variant === "inline"
  return (
    <div
      classList={{
        "group/workspace-move relative shrink-0": true,
        "ms-auto h-5 w-[167px]": inline(),
        "-mt-2.5 h-[46px] w-full rounded-b-[6px] bg-v2-background-bg-layer-02 hover:bg-v2-background-bg-layer-03 transition-colors":
          !inline(),
        hidden: props.dismissed,
      }}
    >
      <SessionWorkspaceMenu
        eligible={props.eligible}
        sessionID={props.sessionID}
        project={props.project}
        directory={props.directory}
        placement={inline() ? "bottom-end" : language.direction() === "rtl" ? "right-start" : "left-start"}
        gutter={inline() ? 4 : -22}
        contentClass={inline() ? undefined : "relative top-3.5"}
        class={
          inline()
            ? "flex h-5 w-full items-center gap-1.5 rounded-[4px] pe-6 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed"
            : "flex h-[46px] w-full items-center gap-2 rounded-b-[6px] px-3 pe-9 pt-2.5 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted focus-visible:outline-none"
        }
      >
        <IconV2 name="workspace-new" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="min-w-0 truncate">{language.t("workspace.move.title")}</span>
      </SessionWorkspaceMenu>
      <button
        type="button"
        class={`absolute flex size-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-none ${
          inline()
            ? "end-0 top-1/2"
            : "hover-reveal end-3 top-[calc(50%+5px)] group-hover/workspace-move:opacity-100 group-focus-within/workspace-move:opacity-100"
        }`}
        aria-label={language.t("common.dismiss")}
        onClick={(event) => {
          event.stopPropagation()
          props.onDismiss()
        }}
      >
        <IconV2 name="xmark-small" />
      </button>
    </div>
  )
}

function SessionSummaryPanel(props: {
  project: Project
  directory: string
  local: boolean
  branch?: string
  baseBranch?: string
  diffs?: { additions: number; deletions: number }[]
  sessionID: string
  moveEligible: boolean
  moveDismissed: boolean
  onMoveDismiss: () => void
  onReview: () => void
}) {
  const language = useLanguage()
  const location = () => {
    if (props.local) return language.t("session.new.workspace.local")
    const workspace = workspaceDirectories(props.project).find((item) => containsDirectory(item, props.directory))
    return getFilename(workspace ?? props.directory)
  }
  const branch = () => props.branch ?? props.baseBranch
  const row =
    "flex h-7 w-full items-center gap-2 rounded-[4px] px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base"

  return (
    <div data-component="session-summary-panel" class="w-[280px]">
      <div class="relative z-10 flex flex-col gap-1 overflow-hidden rounded-[6px] bg-v2-background-bg-base px-0.5 py-1.5 shadow-[var(--v2-elevation-raised)]">
        <div class={row}>
          <ProjectAvatar
            fallback={displayName(props.project)}
            src={getProjectAvatarSource(props.project.id, props.project.icon)}
            variant={getProjectAvatarVariant(props.project.icon?.color)}
          />
          <span class="min-w-0 flex-1 truncate text-v2-text-text-muted">{displayName(props.project)}</span>
        </div>
        <SessionWorkspaceMenu
          eligible={props.moveEligible}
          sessionID={props.sessionID}
          project={props.project}
          directory={props.directory}
          placement={language.direction() === "rtl" ? "right-start" : "left-start"}
          gutter={-22}
          class={`${row} hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed`}
        >
          <IconV2 name={props.local ? "monitor" : "workspace-isolated"} class="shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 flex-1 truncate text-start">{location()}</span>
          <IconV2 name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        </SessionWorkspaceMenu>
        <div class={row}>
          <IconV2 name="branch" class="shrink-0 text-v2-icon-icon-muted" />
          <Show
            when={props.branch}
            fallback={
              <span class="flex min-w-0 items-center gap-1.5">
                <span>{language.t("session.summary.noBranch")}</span>
                <Show when={props.baseBranch}>
                  {(base) => (
                    <>
                      <span class="text-v2-text-text-muted">·</span>
                      <span class="truncate text-v2-text-text-faint">
                        {language.t("session.summary.basedOn", { branch: base() })}
                      </span>
                    </>
                  )}
                </Show>
              </span>
            }
          >
            <span class="min-w-0 truncate">{branch()}</span>
          </Show>
        </div>
        <button
          type="button"
          class={`${row} hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none`}
          onClick={props.onReview}
        >
          <IconV2 name="review" class="shrink-0 text-v2-icon-icon-muted" />
          <Show when={props.diffs} fallback={<span>{language.t("session.review.loadingChanges")}</span>}>
            {(diffs) => (
              <Show when={diffs().length > 0} fallback={<span>{language.t("session.review.noChanges")}</span>}>
                <span>{language.plural("ui.sessionTurn.diffs.changed", diffs().length)}</span>
                <span class="text-v2-text-text-muted">·</span>
                <DiffChanges changes={diffs()} />
              </Show>
            )}
          </Show>
        </button>
      </div>
      <Show when={props.local && props.diffs && props.diffs.length > 0 && props.moveEligible}>
        <WorkspaceMoveAction
          variant="panel"
          eligible={props.moveEligible}
          sessionID={props.sessionID}
          project={props.project}
          directory={props.directory}
          dismissed={props.moveDismissed}
          onDismiss={props.onMoveDismiss}
        />
      </Show>
    </div>
  )
}

type MessageTimelineProps = {
  session: TimelineSessionSource
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: boolean
  onUserScroll: () => void
  onHistoryScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  shouldAnchorBottom: boolean
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  userMessages: SessionMessageUser[]
  diffs: Accessor<{ additions: number; deletions: number }[] | undefined>
  onReview: () => void
  workspaceMoveEligible: boolean
  onSummaryOpenChange: (open: boolean) => void
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string) => void) => void
  setScrollToEnd?: (fn: () => void) => void
  setHistoryAnchor?: (handlers: { capture: () => void; restore: (done: boolean) => void }) => void
}

export function MessageTimeline(props: MessageTimelineProps) {
  const controller = createTimelineController({ session: props.session })
  return (
    <MessageTimelineView {...props} data={controller.data} action={controller.action} pending={controller.pending} />
  )
}

function MessageTimelineView(
  props: MessageTimelineProps & {
    data: TimelineController["data"]
    action: TimelineController["action"]
    pending: TimelineController["pending"]
  },
) {
  let touchGesture: number | undefined
  const language = useLanguage()
  const data = useData()
  const sdk = useWorkspaceLocation()
  const shouldAnchorBottom = createMemo(() => props.shouldAnchorBottom)
  const hasScrollGesture = createMemo(() => props.hasScrollGesture)
  const ownerSessionKey = props.data.sessionKey()
  const cached = timelineCache.get(ownerSessionKey)
  const initialMeasurements = cached?.measurements
  const coldBottomMount = !initialMeasurements?.length && shouldAnchorBottom()

  const [listRoot, setListRoot] = createSignal<HTMLDivElement>()
  const sessionID = props.data.sessionID
  const sessionStatus = props.data.status
  const titleLabel = props.data.titleLabel
  const shareUrl = props.data.shareUrl
  const shareEnabled = props.data.shareEnabled
  const parentID = props.data.parentID
  const parentTitle = props.data.parentTitle
  const childTitle = props.data.childTitle
  const projection = props.data.projection
  const sessionDirectory = createMemo(() => props.session.data.info()?.location.directory ?? sdk().directory)
  const project = createMemo(() => {
    const projectID = props.session.data.info()?.projectID
    const value = projectID
      ? data.project.get(projectID)
      : data.project.list().find((item) => containsDirectory(item.canonical, sessionDirectory()))
    if (!value) return
    return { ...value, worktree: value.canonical, worktrees: [] }
  })
  const workspaceSession = createMemo(() => isWorkspaceDirectory(project(), sessionDirectory()))
  createEffect(() => {
    const directory = project()?.worktree
    if (!directory) return
    void data.location.vcs.sync({ directory }).catch(() => undefined)
  })
  const [workspaceSuggestionDismissed, setWorkspaceSuggestionDismissed] = createSignal(false)
  const [summaryOpen, setSummaryOpen] = createSignal(false)
  const setSummary = (open: boolean) => {
    setSummaryOpen(open)
    props.onSummaryOpenChange(open)
  }
  const sessionDiffs = createMemo(props.diffs)
  createEffect(
    on(sessionID, () => {
      setSummary(false)
      setWorkspaceSuggestionDismissed(false)
    }),
  )
  const turnPadding = () => "px-4 md:px-5"
  const showHeader = createMemo(() => props.data.showHeader() || workspaceSession())
  const activeMessageID = projection.activeMessageID
  const assistantMessagesByParent = projection.assistantMessagesByParent
  const lastAssistantGroupKey = projection.lastAssistantGroupKey
  const messageByID = projection.messageByID
  const messageLastRowIndex = projection.messageLastRowIndex
  const messageRowIndex = projection.messageRowIndex
  const timelineRowByKey = projection.rowByKey
  const timelineRows = projection.rows
  const sessionMessageByID = projection.sessionMessageByID
  const noticeContent = (message: SessionMessageInfo) => {
    if (message.type === "agent-switched")
      return {
        label: language.t("ui.tool.agent.default"),
        data: message.previous ? `${message.previous} → ${message.agent}` : message.agent,
      }
    if (message.type === "model-switched")
      return {
        label: language.t("command.category.model"),
        data: `${message.model.providerID}/${message.model.id}`,
      }
    if (message.type === "location-switched")
      return { label: language.t("ui.patch.action.moved"), data: message.location.directory }
    if (message.type === "skill") return { label: language.t("ui.tool.skill"), data: message.name }
    if (message.type === "system") return { label: message.description ?? message.text }
    if (message.type === "compaction") return { label: language.t("ui.messagePart.compaction"), data: message.status }
    if (message.type !== "synthetic") return
    if (message.description === "Continuing after restart") return { label: message.description }
    const source = typeof message.metadata?.source === "string" ? message.metadata.source : undefined
    const state = typeof message.metadata?.state === "string" ? message.metadata.state : undefined
    if (source === "subagent" || source === "shell") {
      const agent = typeof message.metadata?.agent === "string" ? message.metadata.agent : undefined
      const actor = source === "shell" ? language.t("ui.tool.shell") : (agent ?? language.t("ui.tool.agent.default"))
      const label = language.t(
        state === "error"
          ? "session.timeline.notice.failed"
          : state === "cancelled"
            ? "session.timeline.notice.cancelled"
            : "session.timeline.notice.finished",
        { actor },
      )
      return { label, data: message.description }
    }
    return { label: message.description ?? message.text }
  }

  let prependAnchor: { key: string; offset: number } | undefined
  let prependAnchorFrame: number | undefined
  let prependLoading = false
  const clearPrependAnchor = () => {
    prependLoading = false
    prependAnchor = undefined
    if (prependAnchorFrame === undefined) return
    cancelAnimationFrame(prependAnchorFrame)
    prependAnchorFrame = undefined
  }
  const capturePrependAnchor = () => {
    prependLoading = true
    updatePrependAnchor()
  }
  const updatePrependAnchor = () => {
    const root = listRoot()
    if (!root) return
    const view = root.getBoundingClientRect()
    const anchor = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter((item) => item.rect.bottom > view.top && item.rect.top < view.bottom)
      .sort((a, b) => a.rect.top - b.rect.top)[0]
    if (!anchor) return
    if (!anchor.element.dataset.timelineKey) return
    prependAnchor = { key: anchor.element.dataset.timelineKey, offset: anchor.rect.top - view.top }
  }
  const restorePrependAnchor = (done: boolean) => {
    if (done) prependLoading = false
    applyPrependAnchor()
  }
  const applyPrependAnchor = () => {
    const root = listRoot()
    if (!root || !prependAnchor) return
    if (prependAnchorFrame !== undefined) cancelAnimationFrame(prependAnchorFrame)
    let frames = 0
    let stable = 0
    const apply = () => {
      prependAnchorFrame = undefined
      const anchor = prependAnchor
      if (!anchor) return
      const element = root.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(anchor.key)}"]`)
      const delta = element
        ? element.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset
        : undefined
      if (delta !== undefined && Math.abs(delta) > 0.5) {
        root.scrollTop += delta
        stable = 0
      } else {
        stable += 1
      }
      frames += 1
      if (stable >= 30 || frames >= 180) {
        if (!prependLoading) prependAnchor = undefined
        return
      }
      prependAnchorFrame = requestAnimationFrame(apply)
    }
    prependAnchorFrame = requestAnimationFrame(apply)
  }

  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>(cached?.toolOpen ?? {})
  const [renderOverscan, setRenderOverscan] = createSignal(initialMeasurements?.length || coldBottomMount ? 6 : 20)
  let resizePinnedIndexes: number[] = []
  let resizePinFrame: number | undefined
  let virtualContent: HTMLDivElement | undefined
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return timelineRows().length
    },
    getScrollElement: () => listRoot() ?? null,
    observeElementOffset: observeElementOffsetReconnectAware,
    initialOffset: () => (shouldAnchorBottom() ? Number.MAX_SAFE_INTEGER : 0),
    initialMeasurementsCache: initialMeasurements,
    estimateSize: () => timelineFallbackItemSize,
    scrollToFn: (offset, options, instance) => {
      // Expose the computed range before core writes an anchor correction so the browser does not clamp it to the old height.
      if (virtualContent) virtualContent.style.height = `${instance.getTotalSize()}px`
      elementScroll(offset, options, instance)
    },
    get getItemKey() {
      const rows = timelineRows()
      return (index: number) => {
        const row = rows[index]
        // ResizeObserver can report a removed element after its row has left the projection.
        if (!row) return `removed:${index}`
        return TimelineRow.key(row)
      }
    },
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    get scrollMargin() {
      return showHeader() ? 64 : 0
    },
    overscan: 50,
    paddingEnd: 64,
    rangeExtractor: (range) => {
      const id = activeMessageID()
      const active = id ? (messageLastRowIndex().get(id) ?? -1) : -1
      const indexes = defaultRangeExtractor({ ...range, overscan: renderOverscan() })
      return filterVirtualIndexes(
        [...new Set([...resizePinnedIndexes, ...indexes, ...(active < 0 ? [] : [active])])].sort((a, b) => a - b),
        range.count,
      )
    },
  })
  const resizeItem = virtualizer.resizeItem
  let resizeAnchorScheduled = false
  const anchorResizedBottom = () => {
    if (resizeAnchorScheduled || hasScrollGesture()) return
    resizeAnchorScheduled = true
    queueMicrotask(() => {
      resizeAnchorScheduled = false
      if (!shouldAnchorBottom() || hasScrollGesture()) return
      virtualizer.scrollToEnd()
    })
  }
  virtualizer.resizeItem = (index, size) => {
    const item = virtualizer.measurementsCache[index]
    const previous = item ? (virtualizer.itemSizeCache.get(item.key) ?? item.size) : undefined
    const root = listRoot()
    if (root && previous !== undefined && Math.abs(size - previous) > root.clientHeight) {
      const view = root.getBoundingClientRect()
      resizePinnedIndexes = [...root.querySelectorAll<HTMLElement>("[data-index]")]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.bottom > view.top && rect.top < view.bottom
        })
        .map((element) => Number(element.dataset.index))
      if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
      resizePinFrame = requestAnimationFrame(() => {
        resizePinFrame = requestAnimationFrame(() => {
          resizePinFrame = undefined
          resizePinnedIndexes = []
        })
      })
    }
    resizeItem(index, size)
    if (root && shouldAnchorBottom()) anchorResizedBottom()
  }
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
    if (shouldAnchorBottom()) return false
    const first = virtualizer.range?.startIndex
    return first !== undefined && item.index < first
  }
  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )
  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => item.key as string))
  createEffect(() => {
    props.setRevealMessage?.((id) => {
      const index = messageRowIndex().get(id)
      if (index === undefined) return
      virtualizer.scrollToIndex(index, { align: "center" })
    })
    props.setScrollToEnd?.(() => virtualizer.scrollToEnd())
    props.setHistoryAnchor?.({ capture: capturePrependAnchor, restore: restorePrependAnchor })
  })

  let overscanFrame: number | undefined
  onMount(() => {
    overscanFrame = requestAnimationFrame(() => {
      if (shouldAnchorBottom()) virtualizer.scrollToEnd()
      overscanFrame = requestAnimationFrame(() => {
        overscanFrame = undefined
        if (renderOverscan() < 20) setRenderOverscan(20)
        if (shouldAnchorBottom()) virtualizer.scrollToEnd()
      })
    })
  })

  const maybeAnchorBottom = () => {
    if (timelineRows().length === 0) return
    if (!shouldAnchorBottom() || hasScrollGesture()) return
    if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
    clearPrependAnchor()
    if (prependAnchorFrame !== undefined) cancelAnimationFrame(prependAnchorFrame)
    virtualizer.scrollToEnd()
  }

  let measuredSessionKey = props.data.sessionKey()
  createEffect(() => {
    const key = props.data.sessionKey()
    timelineRows().length
    if (measuredSessionKey !== key) {
      measuredSessionKey = key
      virtualizer.measure()
    }
    maybeAnchorBottom()
  })

  onCleanup(() => {
    clearPrependAnchor()
    timelineCache.delete(ownerSessionKey)
    timelineCache.set(ownerSessionKey, { measurements: virtualizer.takeSnapshot(), toolOpen: { ...toolOpen } })
    while (timelineCache.size > 16) timelineCache.delete(timelineCache.keys().next().value!)
    if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
    if (overscanFrame !== undefined) cancelAnimationFrame(overscanFrame)
    props.setRevealMessage?.(() => {})
    props.setScrollToEnd?.(() => {})
    props.setHistoryAnchor?.({ capture: () => {}, restore: () => {} })
  })

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })
  let titleRef: HTMLInputElement | undefined

  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })
  let more: HTMLButtonElement | undefined

  const bindListRoot = (root: HTMLDivElement) => {
    if (root === listRoot()) return
    setListRoot(root)
    props.setScrollRef(root)
  }

  const handleListWheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    if (!prependLoading) clearPrependAnchor()
    const root = event.currentTarget
    const delta = normalizeWheelDelta({
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      rootHeight: root.clientHeight,
    })
    if (!delta) return
    markBoundaryGesture({ root, target: event.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
  }

  const handleListTouchStart = (event: TouchEvent) => {
    if (!prependLoading) clearPrependAnchor()
    touchGesture = event.touches[0]?.clientY
  }

  const handleListTouchMove = (event: TouchEvent & { currentTarget: HTMLDivElement }) => {
    const next = event.touches[0]?.clientY
    const prev = touchGesture
    touchGesture = next
    if (next === undefined || prev === undefined) return

    const delta = prev - next
    if (!delta) return

    markBoundaryGesture({
      root: event.currentTarget,
      target: event.target,
      delta,
      onMarkScrollGesture: props.onMarkScrollGesture,
    })
  }

  const handleListTouchEnd = () => {
    touchGesture = undefined
  }

  const handleListPointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!prependLoading) clearPrependAnchor()
    props.onMarkScrollGesture(event.target)
  }

  const handleListPointerMove = (event: PointerEvent) => {
    if (event.buttons !== 1) return
    props.onMarkScrollGesture(event.target)
  }

  const handleListKeyDown = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    const key = scrollKey(event)
    if (!key) return
    if (!isScrollKeyTarget(event.target, key)) return
    if (scrollKeyOwner(event.currentTarget, event.target, key) !== event.currentTarget) return
    if (!prependLoading) clearPrependAnchor()
    props.onMarkScrollGesture(event.currentTarget)
  }

  const handleListScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (prependLoading) updatePrependAnchor()
    props.onScheduleScrollState(event.currentTarget)
    props.onHistoryScroll()
    if (!props.hasScrollGesture) return
    props.onUserScroll()
    props.onAutoScrollHandleScroll()
    props.onMarkScrollGesture(event.currentTarget)
  }

  onCleanup(() => {
    props.setScrollRef(undefined)
  })

  const selectShareUrlText: JSX.EventHandler<HTMLDivElement, MouseEvent> = (event) => {
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(event.currentTarget)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  createEffect(
    on(
      props.data.sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
          pendingShare: false,
        }),
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      if (!titleRef) return
      titleRef.focus()
      titleRef.select()
    })
  }

  const closeTitleEditor = () => {
    if (props.pending.rename()) return
    setTitle("editing", false)
  }

  const saveTitleEditor = async () => {
    if (await props.action.rename(title.draft)) setTitle("editing", false)
  }

  const workingTurn = (userMessageID: string) => sessionStatus().type !== "idle" && activeMessageID() === userMessageID

  const turnDurationMs = (userMessageID: string) => {
    const message = messageByID().get(userMessageID)
    if (message?.type !== "user") return
    const end = (assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages).reduce<number | undefined>(
      (max, item) => {
        const completed = item.time.completed
        if (typeof completed !== "number") return max
        if (max === undefined) return completed
        return Math.max(max, completed)
      },
      undefined,
    )
    if (typeof end !== "number") return
    if (end < message.time.created) return
    return end - message.time.created
  }

  const assistantCopyPartID = (userMessageID: string) => {
    if (workingTurn(userMessageID)) return null
    const messages = assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const contents = Timeline.contentEntries(message)
      for (let j = contents.length - 1; j >= 0; j--) {
        const entry = contents[j]
        if (entry?.content.type !== "text" || !entry.content.text.trim()) continue
        return entry.id
      }
    }
  }

  const renderAssistantPartGroup = (row: Accessor<TimelineRowMap["AssistantPart"]>, onSizeChange?: () => void) => {
    if (row().group.type === "context") {
      const tools = createMemo(() => {
        const group = row().group
        if (group.type !== "context") return []
        return group.refs.flatMap((ref) => {
          const message = messageByID().get(ref.messageID)
          const content = Timeline.resolveContent(message, ref.partID)
          return message?.type === "assistant" && content?.type === "tool"
            ? [{ message, content, contentID: ref.partID }]
            : []
        })
      })
      const contextOpenKey = () => `context:${row().group.key}`
      const open = createMemo(() => {
        return toolOpen[contextOpenKey()] === true
      })

      return (
        <CurrentContextToolGroup
          sessionID={sessionID()!}
          tools={tools()}
          open={open()}
          onOpenChange={(value) => setToolOpen(contextOpenKey(), value)}
          busy={
            workingTurn(row().userMessageID) && lastAssistantGroupKey().get(row().userMessageID) === row().group.key
          }
          onSizeChange={onSizeChange}
        />
      )
    }

    const message = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return messageByID().get(group.ref.messageID)
    })
    const contentID = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return group.ref.partID
    })
    const content = createMemo(() => {
      const current = message()
      const id = contentID()
      if (current?.type !== "assistant" || !id) return
      return Timeline.resolveContent(current, id)
    })
    const defaultOpen = createMemo(() => {
      const group = row().group
      const current = message()
      if (group.type !== "part" || current?.type !== "assistant") return
      const item = content()
      if (!item) return
      return currentPartDefaultOpen(
        sessionID()!,
        current,
        item,
        group.ref.partID,
        props.data.shellToolPartsExpanded(),
        props.data.editToolPartsExpanded(),
      )
    })
    const id = contentID()
    if (!id) return

    return (
      <Show when={message()?.type === "assistant" ? (message() as SessionMessageAssistant) : undefined}>
        {(message) => (
          <Show when={content()}>
            {(content) => (
              <CurrentAssistantContent
                sessionID={sessionID()!}
                parentID={row().userMessageID}
                message={message()}
                content={content()}
                contentID={id}
                showAssistantCopyPartID={assistantCopyPartID(row().userMessageID)}
                turnDurationMs={turnDurationMs(row().userMessageID)}
                useV2Actions
                defaultOpen={defaultOpen()}
                toolOpen={toolOpen[row().group.key] ?? defaultOpen()}
                onToolOpenChange={(open) => setToolOpen(row().group.key, open)}
                onContentRendered={onSizeChange}
              />
            )}
          </Show>
        )}
      </Show>
    )
  }

  function TimelineRowFrame(input: { row: FramedTimelineRow; children: JSX.Element }) {
    const previousAssistantPart = () => {
      const row = input.row
      return row._tag === "AssistantPart" && row.previousAssistantPart
    }

    return (
      <div
        id={input.row._tag === "UserMessage" ? props.anchor(input.row.userMessageID) : undefined}
        data-message-id={input.row.userMessageID}
        data-timeline-row={input.row._tag}
        classList={{
          "min-w-0 w-full max-w-full": true,
          "md:max-w-200 2xl:max-w-[1000px]": props.centered,
          "md:mx-auto": props.centered,
          "pt-3": previousAssistantPart(),
        }}
      >
        <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
          {input.children}
        </div>
      </div>
    )
  }

  const renderTimelineRow = (row: Accessor<TimelineRow.TimelineRow>, onSizeChange?: () => void) => {
    switch (row()._tag) {
      case "TurnGap":
        return <div data-timeline-row="TurnGap" aria-hidden="true" class="h-6" />
      case "UserMessage": {
        const userMessageRow = row as Accessor<TimelineRowByTag<"UserMessage">>
        const message = createMemo(() => {
          const m = messageByID().get(userMessageRow().userMessageID)
          if (m?.type === "user") return m
        })
        const messageComments = createMemo(() => {
          const current = message()
          return current ? MessageComment.fromMessage(current) : []
        })
        const context = createMemo(() => projection.userContextByID().get(userMessageRow().userMessageID))
        return (
          <TimelineRowFrame row={userMessageRow()}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class={`w-full ${turnPadding()}`}>
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <CurrentUserMessage
                      sessionID={sessionID()!}
                      message={message()}
                      agent={context()?.agent ?? ""}
                      model={context()?.model ?? { id: "", providerID: "" }}
                      actions={props.actions}
                      useV2Actions
                      comments={messageComments()}
                    />
                  </div>
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "Shell": {
        const shellRow = row as Accessor<TimelineRowByTag<"Shell">>
        const message = createMemo(() => {
          const current = sessionMessageByID().get(shellRow().messageID)
          return current?.type === "shell" ? current : undefined
        })
        return (
          <TimelineRowFrame row={shellRow()}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class={`w-full ${turnPadding()}`}>
                  <SessionShellMessage
                    message={message()}
                    defaultOpen={props.data.shellToolPartsExpanded()}
                    open={toolOpen[message().id]}
                    onOpenChange={(open) => setToolOpen(message().id, open)}
                  />
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "Notice": {
        const noticeRow = row as Accessor<TimelineRowByTag<"Notice">>
        const content = createMemo(() => {
          const message = sessionMessageByID().get(noticeRow().messageID)
          return message ? noticeContent(message) : undefined
        })
        return (
          <TimelineRowFrame row={noticeRow()}>
            <Show when={content()}>
              {(content) => (
                <div
                  data-slot="session-timeline-notice"
                  class={`w-full pt-3 pb-1 text-13-regular text-text-weak ${turnPadding()}`}
                >
                  <span class="text-13-medium">{content().label}</span>
                  <Show when={content().data}>{(data) => <span> · {data()}</span>}</Show>
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "TurnDivider": {
        const turnDividerRow = row as Accessor<TimelineRowByTag<"TurnDivider">>
        return (
          <TimelineRowFrame row={turnDividerRow()}>
            <div data-slot="session-turn-message-container" class={`w-full ${turnPadding()}`}>
              <div data-slot="session-turn-compaction">
                <MessageDivider label={language.t("ui.message.interrupted")} />
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "AssistantPart": {
        const assistantPartRow = row as Accessor<TimelineRowByTag<"AssistantPart">>
        return (
          <TimelineRowFrame row={assistantPartRow()}>
            <div data-slot="session-turn-message-container" class={`w-full ${turnPadding()}`}>
              <div
                data-slot="session-turn-assistant-content"
                aria-hidden={workingTurn(assistantPartRow().userMessageID)}
              >
                {renderAssistantPartGroup(assistantPartRow, onSizeChange)}
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "Thinking": {
        const thinkingRow = row as Accessor<TimelineRowByTag<"Thinking">>
        return (
          <TimelineRowFrame row={thinkingRow()}>
            <div data-slot="session-turn-message-container" class={`w-full ${turnPadding()}`}>
              <TimelineThinkingRow
                reasoningHeading={thinkingRow().reasoningHeading}
                showReasoningSummaries={props.data.showReasoningSummaries()}
              />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Retry": {
        const retryRow = row as Accessor<TimelineRowByTag<"Retry">>
        const status = createMemo(() => {
          const retry = (assistantMessagesByParent().get(retryRow().userMessageID) ?? emptyAssistantMessages).at(
            -1,
          )?.retry
          if (!retry) return sessionStatus()
          return { type: "retry" as const, attempt: retry.attempt, message: retry.error.message, next: retry.at }
        })
        return (
          <TimelineRowFrame row={retryRow()}>
            <div data-slot="session-turn-message-container" class={`w-full ${turnPadding()}`}>
              <SessionRetry status={status()} show={activeMessageID() === retryRow().userMessageID} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        const errorRow = row as Accessor<TimelineRowByTag<"Error">>
        return (
          <TimelineRowFrame row={errorRow()}>
            <div data-slot="session-turn-message-container" class={`w-full ${turnPadding()}`}>
              <Card variant="error" class="error-card">
                {errorRow().text}
              </Card>
            </div>
          </TimelineRowFrame>
        )
      }
    }
  }

  function TimelineRowView(props: { row: TimelineRow.TimelineRow; onSizeChange?: () => void }) {
    return renderTimelineRow(() => props.row, props.onSizeChange)
  }

  function VirtualTimelineRow(props: { rowKey: string }) {
    let element: HTMLDivElement
    const initialItem = virtualItemByKey().get(props.rowKey)!
    const initialRow = timelineRowByKey().get(props.rowKey)!
    const item = createMemo(() => virtualItemByKey().get(props.rowKey) ?? initialItem)
    const row = createMemo(() => timelineRowByKey().get(props.rowKey) ?? initialRow)
    const tool = () => {
      const value = row()
      if (value._tag !== "AssistantPart" || value.group.type !== "part") return
      const content = Timeline.resolveContent(messageByID().get(value.group.ref.messageID), value.group.ref.partID)
      if (content?.type === "tool") return content
    }
    const asyncFile = () => ["edit", "write", "apply_patch"].includes(tool()?.name ?? "")
    const [ready, setReady] = createSignal(initialItem.size <= timelineFallbackItemSize || !asyncFile())
    let contentMeasureFrame: number | undefined

    onMount(() => virtualizer.measureElement(element))

    createEffect(
      on(
        () => item().index,
        () => {
          virtualizer.measureElement(element)
        },
        { defer: true },
      ),
    )

    onCleanup(() => {
      if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
      // Solid runs cleanup before it disconnects the row, so defer TanStack's null-ref cleanup.
      queueMicrotask(() => virtualizer.measureElement(null))
    })

    return (
      <div
        data-timeline-key={props.rowKey}
        style={{
          position: "absolute",
          top: `${item().start - (showHeader() ? 64 : 0)}px`,
          left: "0",
          width: "100%",
          height: `${item().size}px`,
          overflow: "clip",
          // Rounded virtual measurements can otherwise clip a framed row's outer paint.
          "overflow-clip-margin": row()._tag === "TurnGap" ? undefined : "0.5px",
        }}
      >
        <div
          ref={(value) => {
            element = value
          }}
          data-index={item().index}
          style={{ "min-height": ready() ? undefined : `${initialItem.size}px` }}
        >
          <TimelineRowView
            row={row()}
            onSizeChange={() => {
              setReady(true)
              if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
              contentMeasureFrame = scheduleConnectedMeasure(element, virtualizer.measureElement)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div class="relative w-full h-full min-w-0" data-workspace-session={workspaceSession() ? "" : undefined}>
      <div
        class="absolute left-1/2 -translate-x-1/2 z-[60] pointer-events-none transition-all duration-200 ease-out"
        classList={{
          "bottom-8": true,
          "opacity-100 translate-y-0 scale-100": props.scroll.overflow && props.scroll.jump,
          "opacity-0 translate-y-2 pointer-events-none": !props.scroll.overflow || !props.scroll.jump,
          "scale-[0.8]": !props.scroll.overflow || !props.scroll.jump,
        }}
      >
        <button
          type="button"
          aria-label={language.t("session.messages.jumpToLatest")}
          class="pointer-events-auto flex items-center justify-center w-8 h-7 px-2 py-1.5 rounded-lg border-none cursor-pointer text-v2-text-text-base backdrop-blur-[2px]"
          style={{
            background: "color-mix(in srgb, var(--v2-background-bg-base) 92%, transparent)",
            "box-shadow": "var(--v2-elevation-raised), 0px 2px 8px var(--v2-background-bg-base)",
          }}
          onClick={props.onResumeScroll}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M12.3333 8.66665L8 13L3.66667 8.66665M8 12.6667V2.83332"
              stroke="currentColor"
              stroke-linecap="square"
            />
          </svg>
        </button>
      </div>
      <ScrollView
        viewportRef={bindListRoot}
        onWheel={handleListWheel}
        onTouchStart={handleListTouchStart}
        onTouchMove={handleListTouchMove}
        onTouchEnd={handleListTouchEnd}
        onTouchCancel={handleListTouchEnd}
        onPointerDown={handleListPointerDown}
        onPointerMove={handleListPointerMove}
        onKeyDown={handleListKeyDown}
        onScroll={handleListScroll}
        onClick={props.onAutoScrollInteraction}
        class="relative min-w-0 w-full h-full"
        style={{
          "--sticky-accordion-top": showHeader() ? "48px" : "0px",
        }}
      >
        <Show when={showHeader()}>
          <div
            data-session-title
            class="sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--v2-background-bg-base)_48px,transparent)] w-full pb-4 pr-3 pl-2.5"
          >
            <div class="h-12 w-full flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 min-w-0 flex-1">
                <div class="flex items-center min-w-0 flex-1 w-full">
                  <Show
                    when={workspaceSession()}
                    fallback={
                      <span class="flex size-6 shrink-0 items-center justify-center text-v2-icon-icon-muted">
                        <IconV2 name="monitor" />
                      </span>
                    }
                  >
                    <TooltipV2
                      placement="bottom-start"
                      value={sessionDirectory()}
                      contentClass="max-w-[calc(100vw-32px)] break-all"
                    >
                      <span
                        tabIndex={0}
                        aria-label={sessionDirectory()}
                        class="flex size-6 shrink-0 items-center justify-center text-v2-icon-icon-accent"
                      >
                        <IconV2 name="workspace-isolated" />
                      </span>
                    </TooltipV2>
                  </Show>
                  <Show when={parentID()}>
                    <button
                      type="button"
                      data-slot="session-title-parent"
                      class="min-w-0 max-w-[40%] truncate pl-2 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:text-v2-text-text-muted"
                      onClick={props.action.navigateParent}
                    >
                      {parentTitle()}
                    </button>
                    <span
                      data-slot="session-title-separator"
                      class="-translate-y-[0.5px] pl-2 pr-1 text-[11px] font-medium text-v2-text-text-faint"
                      aria-hidden="true"
                    >
                      /
                    </span>
                  </Show>
                  <Show when={childTitle() || title.editing}>
                    <Show
                      when={title.editing}
                      fallback={
                        <h1
                          data-slot="session-title-child"
                          class="truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base w-fit rounded-[6px] px-2 py-1 hover:bg-v2-overlay-simple-overlay-hover"
                          onClick={openTitleEditor}
                        >
                          {childTitle()}
                        </h1>
                      }
                    >
                      <InlineInput
                        ref={(el) => {
                          titleRef = el
                        }}
                        data-slot="session-title-child"
                        dir="auto"
                        value={title.draft}
                        disabled={props.pending.rename()}
                        class="block text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base field-sizing-content self-start rounded-[6px] px-2 py-1"
                        style={{
                          "--inline-input-shadow": "none",
                          "text-align": "start",
                        }}
                        onInput={(event) => setTitle("draft", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === "Enter") {
                            event.preventDefault()
                            void saveTitleEditor()
                            return
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            closeTitleEditor()
                          }
                        }}
                        onBlur={closeTitleEditor}
                      />
                    </Show>
                  </Show>
                </div>
              </div>
              <Show when={sessionID()} keyed>
                {(id) => (
                  <div class="shrink-0 flex items-center gap-2">
                    <SessionContextUsage placement="bottom" />
                    <Show when={!parentID() && project()}>
                      {(project) => (
                        <KobaltePopover
                          open={summaryOpen()}
                          placement="bottom-end"
                          gutter={6}
                          onOpenChange={setSummary}
                        >
                          <KobaltePopover.Trigger
                            as={IconButtonV2}
                            icon={<IconV2 name="window-analytics" />}
                            variant="ghost-muted"
                            size="large"
                            state={summaryOpen() ? "pressed" : undefined}
                            aria-label={language.t("session.summary.title")}
                            aria-expanded={summaryOpen()}
                          />
                          <KobaltePopover.Portal>
                            <KobaltePopover.Content class="z-50 border-0 bg-transparent p-0 outline-none">
                              <SessionSummaryPanel
                                project={project()}
                                directory={sessionDirectory()}
                                local={!workspaceSession()}
                                branch={data.location.vcs.info({ directory: sdk().directory })?.branch.current}
                                baseBranch={data.location.vcs.info({ directory: project().worktree })?.branch.current}
                                diffs={sessionDiffs()}
                                sessionID={id}
                                moveEligible={props.workspaceMoveEligible}
                                moveDismissed={workspaceSuggestionDismissed()}
                                onMoveDismiss={() => setWorkspaceSuggestionDismissed(true)}
                                onReview={() => {
                                  setSummary(false)
                                  props.onReview()
                                }}
                              />
                            </KobaltePopover.Content>
                          </KobaltePopover.Portal>
                        </KobaltePopover>
                      )}
                    </Show>
                    <Show when={!parentID()}>
                      <MenuV2
                        gutter={6}
                        placement="bottom-end"
                        open={title.menuOpen}
                        onOpenChange={(open) => {
                          setTitle("menuOpen", open)
                          if (open) return
                        }}
                      >
                        <MenuV2.Trigger
                          as={IconButtonV2}
                          icon={<IconV2 name="outline-dots" />}
                          variant="ghost-muted"
                          size="large"
                          state={share.open || title.pendingShare ? "pressed" : undefined}
                          aria-label={language.t("common.moreOptions")}
                          aria-expanded={title.menuOpen || share.open || title.pendingShare}
                          ref={(el: HTMLButtonElement) => {
                            more = el
                          }}
                        />
                        <MenuV2.Portal>
                          <MenuV2.Content
                            style={{ width: "120px", "min-width": "120px" }}
                            onCloseAutoFocus={(event) => {
                              if (title.pendingRename) {
                                event.preventDefault()
                                setTitle("pendingRename", false)
                                openTitleEditor()
                                return
                              }
                              if (title.pendingShare) {
                                event.preventDefault()
                                requestAnimationFrame(() => {
                                  setShare({ open: true, dismiss: null })
                                  setTitle("pendingShare", false)
                                })
                              }
                            }}
                          >
                            <MenuV2.Item
                              onSelect={() => {
                                setTitle("pendingRename", true)
                                setTitle("menuOpen", false)
                              }}
                            >
                              {language.t("common.rename")}
                            </MenuV2.Item>
                            <Show when={shareEnabled()}>
                              <MenuV2.Item
                                onSelect={() => {
                                  setTitle({ pendingShare: true, menuOpen: false })
                                }}
                              >
                                {language.t("session.share.action.share")}...
                              </MenuV2.Item>
                            </Show>
                            <MenuV2.Item onSelect={() => void props.action.export(id)}>
                              {language.t("common.export")}...
                            </MenuV2.Item>
                            {/* TODO: Need a V2 session archive API. */}
                            <MenuV2.Separator />
                            <MenuV2.Item onSelect={() => props.action.showDelete(id)}>
                              {language.t("common.delete")}...
                            </MenuV2.Item>
                          </MenuV2.Content>
                        </MenuV2.Portal>
                      </MenuV2>

                      <KobaltePopover
                        open={share.open}
                        anchorRef={() => more}
                        placement="bottom-end"
                        gutter={6}
                        modal={false}
                        onOpenChange={(open) => {
                          if (open) setShare("dismiss", null)
                          setShare("open", open)
                        }}
                      >
                        <KobaltePopover.Portal>
                          <KobaltePopover.Content
                            data-component="popover-content"
                            class="flex w-80 max-w-none flex-col items-start gap-3 rounded-[10px] border-0 bg-v2-background-bg-layer-01 p-3 shadow-[var(--v2-elevation-floating)]"
                            style={{ "min-width": "320px" }}
                            onEscapeKeyDown={(event) => {
                              setShare({ dismiss: "escape", open: false })
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onPointerDownOutside={() => {
                              setShare({ dismiss: "outside", open: false })
                            }}
                            onFocusOutside={() => {
                              setShare({ dismiss: "outside", open: false })
                            }}
                            onCloseAutoFocus={(event) => {
                              if (share.dismiss === "outside") event.preventDefault()
                              setShare("dismiss", null)
                            }}
                          >
                            <div class="flex w-full flex-col gap-1.5 px-0.5 pt-0.5">
                              <div class="select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]">
                                {language.t("session.share.popover.title")}
                              </div>
                              <div class="select-none text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted [font-variation-settings:'slnt'_0]">
                                {shareUrl()
                                  ? language.t("session.share.popover.description.shared")
                                  : language.t("session.share.popover.description.unshared")}
                              </div>
                            </div>
                            <div class="flex w-full flex-col gap-2">
                              <Show
                                when={shareUrl()}
                                fallback={
                                  <ButtonV2
                                    variant="contrast"
                                    class="w-full"
                                    onClick={() => void props.action.share()}
                                    disabled={props.pending.share()}
                                  >
                                    {props.pending.share()
                                      ? language.t("session.share.action.publishing")
                                      : language.t("session.share.action.publish")}
                                  </ButtonV2>
                                }
                              >
                                <div class="flex flex-col gap-2">
                                  <div
                                    class="flex h-8 w-full items-center gap-1.5 rounded-[6px] py-1 pl-2.5 pr-1.5 shadow-[var(--v2-elevation-button-neutral)]"
                                    style={{
                                      background:
                                        "linear-gradient(180deg, var(--v2-alpha-light-2) 0%, var(--v2-alpha-light-0) 100%), var(--v2-background-bg-button-neutral)",
                                    }}
                                  >
                                    <div
                                      class="min-w-0 flex-1 truncate select-text cursor-text text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]"
                                      onClick={selectShareUrlText}
                                    >
                                      {shareUrl()}
                                    </div>
                                    <IconButtonV2
                                      type="button"
                                      size="small"
                                      variant="ghost-muted"
                                      icon={<IconV2 name="outline-copy" />}
                                      aria-label={language.t("session.share.copy.copyLink")}
                                      onClick={() => void props.action.copyShareUrl()}
                                    />
                                    <IconButtonV2
                                      type="button"
                                      size="small"
                                      variant="ghost-muted"
                                      icon={<IconV2 name="outline-square-arrow" />}
                                      aria-label={language.t("session.share.action.view")}
                                      onClick={props.action.viewShare}
                                      disabled={props.pending.unshare()}
                                    />
                                  </div>
                                  <div class="flex w-full">
                                    <ButtonV2
                                      variant="outline"
                                      class="w-full"
                                      onClick={() => void props.action.unshare()}
                                      disabled={props.pending.unshare()}
                                    >
                                      {props.pending.unshare()
                                        ? language.t("session.share.action.unpublishing")
                                        : language.t("session.share.action.unpublish")}
                                    </ButtonV2>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          </KobaltePopover.Content>
                        </KobaltePopover.Portal>
                      </KobaltePopover>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>
        <div
          data-timeline-virtual-content
          ref={(element) => {
            virtualContent = element
            props.setContentRef(element)
          }}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          <For each={virtualRowKeys()}>{(rowKey) => <VirtualTimelineRow rowKey={rowKey} />}</For>
          <Show when={timelineRows().length > 0}>
            <div
              data-timeline-row="bottom-spacer"
              aria-hidden="true"
              class="h-16 absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualizer.getTotalSize() - 64}px)` }}
            />
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
