import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { createVirtualizer, defaultRangeExtractor, elementScroll, type VirtualItem } from "@tanstack/solid-virtual"
import { Accordion } from "@opencode-ai/ui/accordion"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import {
  ContextToolGroup,
  Message,
  MessageDivider,
  Part as MessagePart,
  partDefaultOpen,
  type UserActions,
} from "@opencode-ai/session-ui/message-part"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SessionRetry } from "@opencode-ai/session-ui/session-retry"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner, ScrollView } from "@opencode-ai/ui/scroll-view"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { TextField } from "@opencode-ai/ui/text-field"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import type { AssistantMessage, ToolPart, UserMessage } from "@/types"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { normalize } from "@opencode-ai/session-ui/session-diff"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useLanguage } from "@/context/language"
import { scheduleConnectedMeasure } from "./measure"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"
import { MessageComment, SummaryDiff, TimelineRow, TimelineRowMap } from "./rows"
import { filterVirtualIndexes } from "./virtual-items"
import { createTimelineController, type TimelineController, type TimelineSessionSource } from "./controller"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"

const emptyTools: ToolPart[] = []
const emptyAssistantMessages: AssistantMessage[] = []

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

function TimelineDiffSummaryRow(props: { diffs: SummaryDiff[] }) {
  const language = useLanguage()
  const maxFiles = 10
  const [state, setState] = createStore({
    showAll: false,
    expanded: [] as string[],
  })
  const showAll = () => state.showAll
  const expanded = () => state.expanded
  const overflow = createMemo(() => Math.max(0, props.diffs.length - maxFiles))
  const visible = createMemo(() => (showAll() ? props.diffs : props.diffs.slice(0, maxFiles)))

  return (
    <div
      data-slot="session-turn-diffs"
      data-component="session-turn-diffs-group"
      data-show-all={showAll() || undefined}
    >
      <div data-slot="session-turn-diffs-header">
        <span data-slot="session-turn-diffs-label">
          {language.plural("ui.sessionTurn.diffs.changed", props.diffs.length)}
        </span>
        <DiffChanges changes={props.diffs} />
        <Show when={overflow() > 0}>
          <span data-slot="session-turn-diffs-toggle" onClick={() => setState("showAll", !showAll())}>
            {showAll() ? language.t("ui.sessionTurn.diffs.showLess") : language.t("ui.sessionTurn.diffs.showAll")}
          </span>
        </Show>
      </div>
      <div data-component="session-turn-diffs-content">
        <Accordion
          multiple
          style={{ "--sticky-accordion-offset": "44px" }}
          value={expanded()}
          onChange={(value) => setState("expanded", Array.isArray(value) ? value : value ? [value] : [])}
        >
          <For each={visible()}>
            {(diff) => {
              const opened = createMemo(() => expanded().includes(diff.file))

              return (
                <Accordion.Item value={diff.file}>
                  <StickyAccordionHeader>
                    <Accordion.Trigger>
                      <div data-slot="session-turn-diff-trigger">
                        <span data-slot="session-turn-diff-path">
                          <Show when={diff.file.includes("/")}>
                            <span data-slot="session-turn-diff-directory">{`\u202A${getDirectory(diff.file)}\u202C`}</span>
                          </Show>
                          <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                        </span>
                        <div data-slot="session-turn-diff-meta">
                          <span data-slot="session-turn-diff-changes">
                            <DiffChanges changes={diff} />
                          </span>
                          <span data-slot="session-turn-diff-chevron">
                            <Icon name="chevron-down" size="small" />
                          </span>
                        </div>
                      </div>
                    </Accordion.Trigger>
                  </StickyAccordionHeader>
                  <Accordion.Content>
                    <Show when={opened()}>
                      <TimelineDiffView diff={diff} />
                    </Show>
                  </Accordion.Content>
                </Accordion.Item>
              )
            }}
          </For>
        </Accordion>
        <Show when={!showAll() && overflow() > 0}>
          <div data-slot="session-turn-diffs-more" onClick={() => setState("showAll", true)}>
            {language.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
          </div>
        </Show>
      </div>
    </div>
  )
}

function TimelineDiffView(props: { diff: SummaryDiff }) {
  const fileComponent = useFileComponent()
  const view = normalize(props.diff)

  return (
    <div data-slot="session-turn-diff-view" data-scrollable>
      <Dynamic component={fileComponent} mode="diff" virtualize={false} fileDiff={view.fileDiff} />
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
  userMessages: UserMessage[]
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string) => void) => void
  setScrollToEnd?: (fn: () => void) => void
  setHistoryAnchor?: (handlers: { capture: () => void; restore: (done: boolean) => void }) => void
}

export function MessageTimeline(props: MessageTimelineProps) {
  const controller = createTimelineController({ session: props.session, userMessages: () => props.userMessages })
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
  const showHeader = props.data.showHeader
  const getMsgParts = props.data.parts
  const getMsgPart = props.data.part
  const projection = props.data.projection
  const activeMessageID = projection.activeMessageID
  const assistantMessagesByParent = projection.assistantMessagesByParent
  const lastAssistantGroupKey = projection.lastAssistantGroupKey
  const messageByID = projection.messageByID
  const sessionMessageByID = projection.sessionMessageByID
  const messageLastRowIndex = projection.messageLastRowIndex
  const messageRowIndex = projection.messageRowIndex
  const timelineRowByKey = projection.rowByKey
  const timelineRows = projection.rows
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
    if (!message || message.role !== "user") return
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

      const parts = getMsgParts(message.id)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }
  }

  const renderAssistantPartGroup = (row: Accessor<TimelineRowMap["AssistantPart"]>, onSizeChange?: () => void) => {
    if (row().group.type === "context") {
      const parts = createMemo(() => {
        const group = row().group
        if (group.type !== "context") return emptyTools
        return group.refs
          .map((ref) => getMsgPart(ref.messageID, ref.partID))
          .filter((part): part is ToolPart => part?.type === "tool")
      })
      const contextOpenKey = () => `context:${row().group.key}`
      const open = createMemo(() => {
        return toolOpen[contextOpenKey()] === true
      })

      return (
        <ContextToolGroup
          parts={parts()}
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
    const part = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return getMsgPart(group.ref.messageID, group.ref.partID)
    })
    const defaultOpen = createMemo(() => {
      const item = part()
      if (!item) return
      return partDefaultOpen(item, props.data.shellToolPartsExpanded(), props.data.editToolPartsExpanded())
    })

    return (
      <Show when={message()}>
        {(message) => (
          <Show when={part()}>
            {(part) => (
              <MessagePart
                part={part()}
                message={message()}
                showAssistantCopyPartID={assistantCopyPartID(row().userMessageID)}
                turnDurationMs={turnDurationMs(row().userMessageID)}
                useV2Actions={props.data.newLayoutDesigns()}
                defaultOpen={defaultOpen()}
                toolOpen={toolOpen[part().id] ?? defaultOpen()}
                onToolOpenChange={(open) => setToolOpen(part().id, open)}
                deferToolContent
                virtualizeDiff={false}
                onContentRendered={onSizeChange}
              />
            )}
          </Show>
        )}
      </Show>
    )
  }

  function TimelineRowFrame(input: { row: FramedTimelineRow; children: JSX.Element }) {
    const anchor = () => {
      const row = input.row
      return row._tag === "CommentStrip" || (row._tag === "UserMessage" && row.anchor)
    }
    const previousAssistantPart = () => {
      const row = input.row
      return row._tag === "AssistantPart" && row.previousAssistantPart
    }

    return (
      <div
        id={anchor() ? props.anchor(input.row.userMessageID) : undefined}
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
      case "CommentStrip": {
        const commentStripRow = row as Accessor<TimelineRowByTag<"CommentStrip">>
        const comments = createMemo(() =>
          getMsgParts(commentStripRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? []),
        )
        return (
          <TimelineRowFrame row={commentStripRow()}>
            <div class="w-full px-4 md:px-5 pb-2">
              <div class="ms-auto max-w-[82%] overflow-x-auto no-scrollbar">
                <div class="flex w-max min-w-full justify-end gap-2">
                  <Index each={comments()}>
                    {(comment) => (
                      <div
                        classList={{
                          "shrink-0 max-w-[260px] rounded-[6px] border-border-weak-base bg-background-stronger px-2.5 py-2": true,
                          "border-[0.5px]": props.data.newLayoutDesigns(),
                          border: !props.data.newLayoutDesigns(),
                        }}
                      >
                        <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                          <FileIcon node={{ path: comment().path, type: "file" }} class="size-3.5 shrink-0" />
                          <span class="truncate">{getFilename(comment().path)}</span>
                          <Show when={comment().selection}>
                            {(selection) => (
                              <span class="shrink-0 text-text-weak">
                                {selection().startLine === selection().endLine
                                  ? `:${selection().startLine}`
                                  : `:${selection().startLine}-${selection().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                          {comment().comment}
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "UserMessage": {
        const userMessageRow = row as Accessor<TimelineRowByTag<"UserMessage">>
        const message = createMemo(() => {
          const m = messageByID().get(userMessageRow().userMessageID)
          if (m?.role === "user") return m
        })
        const messageComments = createMemo(() => {
          if (!props.data.newLayoutDesigns()) return []
          return getMsgParts(userMessageRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? [])
        })
        return (
          <TimelineRowFrame row={userMessageRow()}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <Message
                      message={message()}
                      parts={getMsgParts(userMessageRow().userMessageID)}
                      actions={props.actions}
                      useV2Actions={props.data.newLayoutDesigns()}
                      comments={messageComments()}
                    />
                  </div>
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
                <div data-slot="session-timeline-notice" class="w-full px-4 pt-3 pb-1 md:px-5 text-13-regular">
                  <span class="text-13-medium text-text-strong">{content().label}</span>
                  <Show when={content().data}>{(data) => <span class="text-text-weak"> · {data()}</span>}</Show>
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
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-compaction">
                <MessageDivider
                  label={language.t(
                    turnDividerRow().label === "compaction" ? "ui.messagePart.compaction" : "ui.message.interrupted",
                  )}
                />
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "AssistantPart": {
        const assistantPartRow = row as Accessor<TimelineRowByTag<"AssistantPart">>
        return (
          <TimelineRowFrame row={assistantPartRow()}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
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
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
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
        return (
          <TimelineRowFrame row={retryRow()}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <SessionRetry status={sessionStatus()} show={activeMessageID() === retryRow().userMessageID} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "DiffSummary": {
        const diffSummaryRow = row as Accessor<TimelineRowByTag<"DiffSummary">>
        return (
          <TimelineRowFrame row={diffSummaryRow()}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineDiffSummaryRow diffs={diffSummaryRow().diffs} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        const errorRow = row as Accessor<TimelineRowByTag<"Error">>
        return (
          <TimelineRowFrame row={errorRow()}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
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
      const part = getMsgPart(value.group.ref.messageID, value.group.ref.partID)
      if (part?.type === "tool") return part
    }
    const asyncFile = () => ["edit", "write", "apply_patch"].includes(tool()?.tool ?? "")
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
    <div class="relative w-full h-full min-w-0">
      <div
        class="absolute left-1/2 -translate-x-1/2 z-[60] pointer-events-none transition-all duration-200 ease-out"
        classList={{
          "bottom-8": props.data.newLayoutDesigns(),
          "bottom-6": !props.data.newLayoutDesigns(),
          "opacity-100 translate-y-0 scale-100": props.scroll.overflow && props.scroll.jump,
          "opacity-0 translate-y-2 pointer-events-none": !props.scroll.overflow || !props.scroll.jump,
          "scale-[0.8]": (!props.scroll.overflow || !props.scroll.jump) && props.data.newLayoutDesigns(),
          "scale-95": (!props.scroll.overflow || !props.scroll.jump) && !props.data.newLayoutDesigns(),
        }}
      >
        <Show
          when={props.data.newLayoutDesigns()}
          fallback={
            <button
              type="button"
              aria-label={language.t("session.messages.jumpToLatest")}
              class="pointer-events-auto flex items-center justify-center w-10 h-8 bg-transparent border-none cursor-pointer p-0 group"
              onClick={props.onResumeScroll}
            >
              <div
                class="flex items-center justify-center w-8 h-6 rounded-[6px] border border-border-weaker-base bg-[color-mix(in_srgb,var(--surface-raised-stronger-non-alpha)_80%,transparent)] backdrop-blur-[0.75px] transition-colors group-hover:border-[var(--border-weak-base)] group-hover:[--icon-base:var(--icon-hover)]"
                style={{
                  "box-shadow":
                    "0 51px 60px 0 rgba(0,0,0,0.10), 0 15px 18px 0 rgba(0,0,0,0.12), 0 6.386px 7.513px 0 rgba(0,0,0,0.12), 0 2.31px 2.717px 0 rgba(0,0,0,0.20)",
                }}
              >
                <Icon name="arrow-down-to-line" size="small" />
              </div>
            </button>
          }
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
        </Show>
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
            classList={{
              "sticky top-0 z-30": true,
              "bg-[linear-gradient(to_bottom,var(--v2-background-bg-base)_48px,transparent)]":
                props.data.newLayoutDesigns(),
              "bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]":
                !props.data.newLayoutDesigns(),
              "w-full": true,
              "pb-4": true,
              "pr-3": true,
              "pl-2.5": props.data.newLayoutDesigns(),
              "pl-2 md:pl-4": !props.data.newLayoutDesigns(),
              "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered && !props.data.newLayoutDesigns(),
            }}
          >
            <div class="h-12 w-full flex items-center justify-between gap-2">
              <div
                classList={{
                  "flex items-center gap-1 min-w-0 flex-1": true,
                  "pr-3": !props.data.newLayoutDesigns(),
                }}
              >
                <div class="flex items-center min-w-0 flex-1 w-full">
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
                          classList={{
                            "truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base": true,
                            "w-fit rounded-[6px] px-2 py-1 hover:bg-v2-overlay-simple-overlay-hover":
                              props.data.newLayoutDesigns(),
                            "grow-1 min-w-0": !props.data.newLayoutDesigns(),
                          }}
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
                        classList={{
                          "block text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base": true,
                          "w-full flex-1 grow-1 min-w-0 pl-1 -ml-1 rounded-[6px]": !props.data.newLayoutDesigns(),
                          "field-sizing-content self-start rounded-[6px] px-2 py-1 ": props.data.newLayoutDesigns(),
                        }}
                        style={{
                          "--inline-input-shadow": props.data.newLayoutDesigns()
                            ? "none"
                            : "var(--shadow-xs-border-select)",
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
                  <div
                    classList={{
                      "shrink-0 flex items-center": true,
                      "gap-2": props.data.newLayoutDesigns(),
                      "gap-3": !props.data.newLayoutDesigns(),
                    }}
                  >
                    <SessionContextUsage
                      placement="bottom"
                      buttonAppearance={props.data.newLayoutDesigns() ? "v2" : "default"}
                    />
                    <Show when={!parentID()}>
                      <Show
                        when={props.data.newLayoutDesigns()}
                        fallback={
                          <DropdownMenu
                            gutter={4}
                            placement="bottom-end"
                            open={title.menuOpen}
                            onOpenChange={(open) => {
                              setTitle("menuOpen", open)
                              if (open) return
                            }}
                          >
                            <DropdownMenu.Trigger
                              as={IconButton}
                              icon="dot-grid"
                              variant="ghost"
                              class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                              classList={{
                                "bg-surface-base-active": share.open || title.pendingShare,
                              }}
                              aria-label={language.t("common.moreOptions")}
                              aria-expanded={title.menuOpen || share.open || title.pendingShare}
                              ref={(el: HTMLButtonElement) => {
                                more = el
                              }}
                            />
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                style={{ "min-width": "104px" }}
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
                                <DropdownMenu.Item
                                  onSelect={() => {
                                    setTitle("pendingRename", true)
                                    setTitle("menuOpen", false)
                                  }}
                                >
                                  <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                                <Show when={shareEnabled()}>
                                  <DropdownMenu.Item
                                    onSelect={() => {
                                      setTitle({ pendingShare: true, menuOpen: false })
                                    }}
                                  >
                                    <DropdownMenu.ItemLabel>
                                      {language.t("session.share.action.share")}
                                    </DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </Show>
                                <DropdownMenu.Item onSelect={() => void props.action.export(id)}>
                                  <DropdownMenu.ItemLabel>{language.t("common.export")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                                {/* TODO: Need a V2 session archive API. */}
                                <DropdownMenu.Separator />
                                <DropdownMenu.Item onSelect={() => props.action.showDelete(id)}>
                                  <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu>
                        }
                      >
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
                      </Show>

                      <KobaltePopover
                        open={share.open}
                        anchorRef={() => more}
                        placement="bottom-end"
                        gutter={props.data.newLayoutDesigns() ? 6 : 4}
                        modal={false}
                        onOpenChange={(open) => {
                          if (open) setShare("dismiss", null)
                          setShare("open", open)
                        }}
                      >
                        <KobaltePopover.Portal>
                          <KobaltePopover.Content
                            data-component="popover-content"
                            classList={{
                              "flex w-80 max-w-none flex-col items-start gap-3 rounded-[10px] border-0 bg-v2-background-bg-layer-01 p-3 shadow-[var(--v2-elevation-floating)]":
                                props.data.newLayoutDesigns(),
                            }}
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
                            <Show
                              when={props.data.newLayoutDesigns()}
                              fallback={
                                <div class="flex flex-col p-3">
                                  <div class="flex flex-col gap-1">
                                    <div class="text-13-medium text-text-strong">
                                      {language.t("session.share.popover.title")}
                                    </div>
                                    <div class="text-12-regular text-text-weak">
                                      {shareUrl()
                                        ? language.t("session.share.popover.description.shared")
                                        : language.t("session.share.popover.description.unshared")}
                                    </div>
                                  </div>
                                  <div class="mt-3 flex flex-col gap-2">
                                    <Show
                                      when={shareUrl()}
                                      fallback={
                                        <Button
                                          size="large"
                                          variant="primary"
                                          class="w-full"
                                          onClick={() => void props.action.share()}
                                          disabled={props.pending.share()}
                                        >
                                          {props.pending.share()
                                            ? language.t("session.share.action.publishing")
                                            : language.t("session.share.action.publish")}
                                        </Button>
                                      }
                                    >
                                      <div class="flex flex-col gap-2">
                                        <TextField
                                          value={shareUrl() ?? ""}
                                          readOnly
                                          copyable
                                          copyKind="link"
                                          tabIndex={-1}
                                          class="w-full"
                                        />
                                        <div class="grid grid-cols-2 gap-2">
                                          <Button
                                            size="large"
                                            variant="secondary"
                                            class="w-full shadow-none border border-border-weak-base"
                                            onClick={() => void props.action.unshare()}
                                            disabled={props.pending.unshare()}
                                          >
                                            {props.pending.unshare()
                                              ? language.t("session.share.action.unpublishing")
                                              : language.t("session.share.action.unpublish")}
                                          </Button>
                                          <Button
                                            size="large"
                                            variant="primary"
                                            class="w-full"
                                            onClick={props.action.viewShare}
                                            disabled={props.pending.unshare()}
                                          >
                                            {language.t("session.share.action.view")}
                                          </Button>
                                        </div>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              }
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
                            </Show>
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
