import {
  createVirtualizer,
  defaultRangeExtractor,
  elementScroll,
  observeElementRect,
  type Range,
  type VirtualItem,
} from "@tanstack/solid-virtual"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner, ScrollView } from "@opencode/ui/scroll-view"
import { Predicate } from "effect"
import { Timeline, TimelineRow } from "@opencode/session-ui/timeline/projection"
import { useLanguage } from "@/runtime/i18n/language"
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import type { createTimelineProjection } from "./projection"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"
import { filterVirtualIndexes } from "./virtual-items"
import {
  ACTIVATED,
  CHECK_REQUESTED,
  COLD_REVEAL_TIMEOUT,
  coldMountFlushing,
  coldMountHidden,
  coldMountTailOnly,
  createColdMountState,
  DEACTIVATED,
  DISPOSED,
  SIZES_FLUSHED,
  SIZES_FLUSHING,
  transitionColdMount,
  type ColdMountEffect,
  type ColdMountEvent,
  type ColdMountSample,
} from "./cold-mount"
import { prefersReducedMotion } from "@opencode/ui/motion"
import { holdLandingWidth } from "@/shell/panel-motion"
import type { TimelineFollow } from "./follow"
import {
  CONTACT_LOST_EVENT,
  defersAdjustments,
  END_EPSILON,
  isTouchHeld,
  MIN_OVERFLOW,
  needsEndProbe,
  ZOOM_SLACK,
} from "./machine"

const fallbackItemSize = 60

const pendingMarkdown = '[data-component="markdown"]:not([data-markdown-ready])'

const upwardKeys = new Set(["up", "page-up", "home"])

const settledEvent = { type: "scroll.settled", atReachableEnd: false } as const

const settledAtEndEvent = { type: "scroll.settled", atReachableEnd: true } as const

const touchStartEvent = { type: "touch.start", nested: false } as const

const nestedTouchStartEvent = { type: "touch.start", nested: true } as const

const touchEndEvent = { type: "touch.end", scrolling: false } as const

const touchMomentumEvent = { type: "touch.end", scrolling: true } as const

const pointerDownEvent = { type: "pointer.down" } as const

const pointerUpEvent = { type: "pointer.up" } as const

const cache = new Map<
  string,
  {
    measurements: VirtualItem[]
    toolOpen: Record<string, boolean | undefined>
    patchGroupKeys: Map<string, string>
    presentationKey?: string
  }
>()

type Projection = Pick<
  ReturnType<typeof createTimelineProjection>,
  "activeMessageID" | "messageByID" | "messageLastRowIndex" | "messageRowIndex" | "rowByKey" | "rows"
>

type Input = {
  active?: Accessor<boolean>
  sessionKey: Accessor<string>
  presentationKey?: Accessor<string>
  /** Whether what the user opened or closed survives a change of detail setting, as in the New timeline. */
  keepsDisclosure?: boolean
  projection: Projection
  showHeader: Accessor<boolean>
  /** Whether the timeline follows the newest content. Drives every anchoring decision. */
  follow: TimelineFollow
  scroll: Accessor<{ overflow: boolean; jump: boolean }>
  onResumeScroll: (behavior?: ScrollBehavior) => void
  setScrollRef: (element: HTMLDivElement | undefined) => void
  /** The rows' content changed height. */
  onContentResize: () => void
  /** Height of the composer region floating over the timeline's bottom edge, where the timeline fades out. */
  bottomInset?: Accessor<number>
  setVisibleRef?: (element: HTMLDivElement | undefined) => void
  onScheduleScrollState: (element: HTMLDivElement) => void
  onUserScroll: (target?: EventTarget | null) => void
  onHistoryScroll: () => void
  canRenderImmediately?: (
    row: TimelineRow.TimelineRow,
    disclosure: Readonly<Record<string, boolean | undefined>>,
  ) => boolean
  setRevealMessage?: (fn: (id: string, partID?: string) => void) => void
  setScrollToEnd?: (fn: (behavior?: ScrollBehavior) => void) => void
  /** Pages the timeline for keys pressed outside it, such as PageUp in the composer. */
  setPage?: (fn: (direction: 1 | -1) => void) => void
  reveal?: TimelineRouteReveal
}

/** A tool call the route asks this timeline to open on; `consume` marks its history entry attempted. */
export type TimelineRouteReveal = {
  pending: () => { readonly entryKey: string; readonly target: string } | undefined
  consume: (entryKey: string) => void
}

type ViewProps = {
  header: JSX.Element
  bottomSpacer?: JSX.Element
  deferred: (row: TimelineRow.TimelineRow) => boolean
  renderRow: (row: Accessor<TimelineRow.TimelineRow>, onSizeChange?: () => void) => JSX.Element
}

export function createTimelineVirtualizer(input: Input) {
  const language = useLanguage()
  const active = () => input.active?.() !== false
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const topOffset = () => (input.showHeader() ? 64 : isDesktop() ? 0 : 16)
  // Reserved below the last row: a 36px lane for the live status row and its background hint, a 14px gap, then the
  // activity pill and its 10px composer gap. Without hover the pill grows from 32px to its 44px touch size
  // (composer-lane.css), and the tail grows with it. Both come and go inside it, so neither moves the rows above.
  const touch = createMediaQuery("(hover: none)")
  const tailSize = () => (touch() ? 104 : 92)
  const ownerSessionKey = input.sessionKey()
  const entry = cache.get(ownerSessionKey)
  const cached = entry?.presentationKey === input.presentationKey?.() ? entry : undefined
  const initialMeasurements = cached?.measurements

  const [coldMount, setColdMount] = createSignal(
    createColdMountState(!initialMeasurements?.length && input.follow.following()),
  )

  // Each flips once per mount, so the many hidden-phase transitions do not reach the rows or the range.
  const coldHidden = createMemo(() => coldMountHidden(coldMount()))
  const coldTailOnly = createMemo(() => coldMountTailOnly(coldMount()))
  const [listRoot, setListRoot] = createSignal<HTMLDivElement>()
  const [visibleArea, setVisibleArea] = createSignal<HTMLDivElement>()
  const [viewRoot, setViewRoot] = createSignal<HTMLDivElement>()
  const bottomInset = () => input.bottomInset?.() ?? 0

  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>(
    (input.keepsDisclosure ? entry : cached)?.toolOpen ?? {},
  )

  const patchGroupKeys = cached?.patchGroupKeys ?? new Map<string, string>()
  createEffect(
    on(
      () => input.presentationKey?.(),
      () => {
        patchGroupKeys.clear()

        if (!input.keepsDisclosure) setToolOpen(reconcile({}))
      },
      { defer: true },
    ),
  )

  const [rendering, setRendering] = createStore({ scrollAdjustment: 0 })

  const rows = input.projection.rows
  const rowByKey = input.projection.rowByKey

  const rowKeys = createMemo(() => rows().map(TimelineRow.key), undefined, {
    equals: (previous, next) => previous.length === next.length && previous.every((key, index) => key === next[index]),
  })

  const knownKeys = new Set(rowKeys())
  const addedKeys = new Set<string>()

  const getItemKey = createMemo(() => {
    const keys = rowKeys()
    keys
      .filter((key) => !knownKeys.has(key))
      .forEach((key) => {
        knownKeys.add(key)
        addedKeys.add(key)
      })

    return (index: number) => keys[index] ?? `removed:${index}`
  })

  const rangeExtractor = createMemo(() => {
    const id = input.projection.activeMessageID()
    const active = id ? (input.projection.messageLastRowIndex().get(id) ?? -1) : -1
    const initialTail = coldTailOnly() && input.follow.following()
    const anchor = input.follow.anchor()
    const anchored = anchor ? rowKeys().indexOf(anchor.key) : -1

    return (range: Range) => {
      // Batch a bounded cheap suffix, but stop before unknown/large content.
      // A large tail still mounts alone before estimates expose earlier history.
      const start = Math.max(0, range.startIndex - 2)

      const boundary = initialTail
        ? rows()
            .slice(start, range.count)
            .findLastIndex(
              (row) =>
                !(
                  Predicate.isTagged(row, "AssistantPart") &&
                  row.group.type === "context" &&
                  row.group.refs.length <= 64 &&
                  !toolOpen[`context:${row.group.key}`]
                ) && !input.canRenderImmediately?.(row, toolOpen),
            )
        : -1

      const first = Math.min(range.count - 1, start + boundary + 1)

      const indexes = initialTail
        ? Array.from({ length: range.count - first }, (_, index) => first + index)
        : defaultRangeExtractor({ ...range, overscan: 2 })

      return filterVirtualIndexes(
        [...new Set([...indexes, ...[active, anchored].filter((index) => index >= 0)])].sort((a, b) => a - b),
        range.count,
      )
    }
  })

  const measuredElements = new WeakSet<Element>()
  // The finger's last position, a measurement only: whether it is down is the follow machine's `isTouchHeld`.
  let lastTouchY = 0
  let touchTarget: EventTarget | null = null
  // Size compensation deferred during one resize delivery, committed or dropped before the delivery ends.
  let touchAdjustment = 0
  let maxScroll = 0
  let virtualContent: HTMLDivElement | undefined
  let rowLayer: HTMLDivElement | undefined
  // While a sidebar's spring moves the timeline's edge, rows keep the width they land at, centred on the timeline, so
  // their text wraps once instead of on every frame. The first column in view (turn gaps span the row) keeps its start
  // edge where it was.
  holdLandingWidth(
    () => rowLayer,
    () => {
      const top = listRoot()?.getBoundingClientRect().top ?? 0

      return [
        ...(rowLayer?.querySelectorAll<HTMLElement>(
          '[data-timeline-key] [data-timeline-row]:not([data-timeline-row="TurnGap"])',
        ) ?? []),
      ].find((row) => row.getBoundingClientRect().bottom > top)
    },
  )
  let scrollTop = 0
  // Reused for every scroll: the transition only reads it, so a scroll allocates nothing.
  const scrollEvent = { type: "scroll" as const, scrollTop: 0, previousTop: 0, maxScroll: 0, previousMaxScroll: 0 }
  const intentEvent = { type: "scroll.intent" as const, upward: false, overflow: false }
  const touchDragEvent = { type: "touch.drag" as const, overflow: false }
  let reportOffset: ((offset: number, scrolling: boolean) => void) | undefined
  let reportRect: ((rect: { width: number; height: number }) => void) | undefined
  const [headerHeight, setHeaderHeight] = createSignal(48)

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return rows().length
    },
    getScrollElement: () => listRoot() ?? null,
    // The viewport runs on under the composer region. The virtualizer sees only the part above it, which the
    // inset spacer below the rows keeps consistent with the native scroll range.
    observeElementRect: (instance, callback) => {
      reportRect = (rect) => {
        const root = listRoot()
        batch(() => {
          // The container-responsive header can be 48px or 80px.
          setHeaderHeight(
            root ? parseFloat(getComputedStyle(root).getPropertyValue("--session-header-height")) || 48 : 48,
          )
          callback({ width: rect.width, height: Math.max(0, rect.height - bottomInset()) })
        })
      }

      return observeElementRect(instance, (rect) => {
        if (active()) reportRect?.(rect)
      })
    },
    // Route navigation detaches and reattaches the scroll element, which drops its offset.
    observeElementOffset: (instance, callback) => {
      reportOffset = (offset, scrolling) => {
        if (!active()) return
        // Rows and the sizer use the opposite translation while native touch
        // scrolling keeps its own offset. Range selection uses the logical offset.
        batch(() => {
          const logicalOffset = offset + rendering.scrollAdjustment
          callback(rendering.scrollAdjustment ? Math.max(0, logicalOffset) : offset, scrolling)
          // Reconcile both start boundaries in one native write. Gradually
          // clamping row translations lets the compositor paint between
          // corrections and makes the content oscillate at the top.
          const root = listRoot()

          if (
            rendering.scrollAdjustment !== 0 &&
            root &&
            (logicalOffset <= 0 || offset <= 0 || (isTouchHeld(input.follow.peek()) && offset <= root.clientHeight))
          )
            flushTouchAdjustment()

          if (scrolling) return

          if (!isTouchHeld(input.follow.peek())) flushTouchAdjustment()
          input.follow.dispatch(
            root && needsEndProbe(input.follow.peek()) && atReachableEnd(root) ? settledAtEndEvent : settledEvent,
          )
        })
        dispatchCold(CHECK_REQUESTED)
      }

      return observeElementOffsetReconnectAware(instance, reportOffset, () => {
        if (!active()) return
        virtualContent?.querySelectorAll<HTMLDivElement>("[data-index]").forEach(virtualizer.measureElement)

        if (input.follow.following()) virtualizer.scrollToEnd()
        dispatchCold(CHECK_REQUESTED)
      })
    },
    initialOffset: () => (input.follow.following() ? Number.MAX_SAFE_INTEGER : 0),
    initialMeasurementsCache: initialMeasurements,
    estimateSize: () => fallbackItemSize,
    // A newly observed element gets a real ResizeObserver box before paint. Reuse
    // its snapshot on attachment, but later explicit measurements must read layout
    // so deferred/rewrapped content cannot keep stale, clipped heights (TanStack/virtual#1183).
    measureElement: (element, entry, instance) => {
      if (!active() || !element.isConnected)
        return (
          instance.itemSizeCache.get(instance.options.getItemKey(instance.indexFromElement(element))) ??
          fallbackItemSize
        )
      const initial = !measuredElements.has(element)
      measuredElements.add(element)
      const box = entry?.borderBoxSize[0]

      if (box) return Math.round(box.blockSize)

      if (initial) {
        const size = instance.itemSizeCache.get(instance.options.getItemKey(instance.indexFromElement(element)))

        if (size !== undefined || untrack(coldHidden)) return size ?? fallbackItemSize
      }

      return element.offsetHeight
    },
    scrollToFn: (offset, options, instance) => {
      if (!active()) return

      if (coldMountFlushing(untrack(coldMount)) && input.follow.following()) return
      touchAdjustment = 0
      setRendering("scrollAdjustment", 0)

      if (virtualContent) virtualContent.style.height = `${instance.getTotalSize()}px`
      elementScroll(offset, options, instance)
    },
    get getItemKey() {
      return getItemKey()
    },
    get anchorTo() {
      return input.follow.following() ? "end" : "start"
    },
    get followOnAppend() {
      return input.follow.following()
    },
    scrollEndThreshold: 80,
    get scrollMargin() {
      // Empty projections still need the bottom spacer for running status.
      return rows().length > 0 ? topOffset() : 0
    },
    get paddingEnd() {
      return tailSize()
    },
    // Revealed prompts sit below the solid header and its 16px fade.
    get scrollPaddingStart() {
      return input.showHeader() ? headerHeight() + 16 : 0
    },
    get rangeExtractor() {
      return rangeExtractor()
    },
  })

  const resizeItem = virtualizer.resizeItem
  const pendingSizes = new Map<number, { key: string; size: number }>()
  let resizeScheduled = false
  // Read the whole measurement delivery before committing reactive row sizes.
  // Otherwise each row can render and force layout before the next is measured.
  virtualizer.resizeItem = (index, size) => {
    if (!active()) return
    const row = rows()[index]

    if (!row) return
    const key = TimelineRow.key(row)

    if ((virtualizer.itemSizeCache.get(key) ?? fallbackItemSize) === size) {
      pendingSizes.delete(index)

      return
    }

    pendingSizes.set(index, { key, size })

    if (resizeScheduled) return
    resizeScheduled = true
    queueMicrotask(() => {
      resizeScheduled = false

      if (!pendingSizes.size) return
      const sizes = [...pendingSizes]
      pendingSizes.clear()

      if (!active()) {
        touchAdjustment = 0

        return
      }

      // The hidden pinned mount needs one bottom write after the whole batch,
      // not a layout-forcing scroll adjustment for every measured row.
      dispatchCold(SIZES_FLUSHING)
      batch(() => {
        sizes.forEach(([index, value]) => {
          const row = rows()[index]

          if (!row || TimelineRow.key(row) !== value.key) return
          resizeItem(index, value.size)

          // TanStack recalculates its range after each resize. Advance the
          // logical fold before deciding whether the next row needs anchoring.
          if (!touchAdjustment) return
          const delta = touchAdjustment
          touchAdjustment = 0

          // A delta deferred under momentum that has since ended is dropped rather than translating the rows.
          if (!defersAdjustments(input.follow.peek())) return
          setRendering("scrollAdjustment", (value) => value + delta)
          const root = listRoot()

          if (root) reportOffset?.(root.scrollTop, virtualizer.isScrolling)
        })
      })
      dispatchCold(SIZES_FLUSHED)
      pinAnchor()

      if (untrack(coldHidden)) pinColdBottom()
      dispatchCold(CHECK_REQUESTED)

      if (untrack(coldHidden) || !input.follow.following()) return
      const root = listRoot()

      // Reopening a settled scroll-to-end operation can fight subsequent keyboard scrolling.
      if (root && !atReachableEnd(root)) virtualizer.scrollToEnd()
    })
  }

  onCleanup(() => pendingSizes.clear())
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
    // Prepended rows can resize more than once as deferred content mounts. Keep
    // compensating while they remain entirely above the visible content fold.
    const first = instance.range?.startIndex

    const adjust = addedKeys.has(String(item.key))
      ? item.end <= (instance.scrollOffset ?? 0) + instance.scrollAdjustments + instance.options.scrollMargin
      : first !== undefined && item.index < first

    if (!defersAdjustments(input.follow.peek())) return adjust

    // iOS defers native scroll writes until momentum ends. Keep the same visual
    // anchor now, rather than moving rows now and snapping the viewport back later.
    if (adjust) touchAdjustment += delta

    return false
  }

  // Scrolls to a tool call, named by its ID or by the shell ID a backgrounded shell call reports, and expands it and
  // the collapsed context group that hides it. Returns whether the call is in the list.
  function revealPart(target: string) {
    if (!active()) return false

    const matches = (ref: { messageID: string; partID: string }) => {
      const content = Timeline.resolveContent(input.projection.messageByID().get(ref.messageID), ref.partID)

      return (
        content?.type === "tool" &&
        (content.id === target || (content.state.status !== "streaming" && content.state.metadata?.shellID === target))
      )
    }

    const found = rows()
      .flatMap((row, index) =>
        Predicate.isTagged(row, "AssistantPart")
          ? (row.group.type === "part" ? [row.group.ref] : row.group.refs).flatMap((ref) =>
              matches(ref) ? [{ group: row.group, index, partID: ref.partID }] : [],
            )
          : [],
      )
      .at(-1)

    if (!found) return false

    const key = found.group.key

    prepareNavigation()
    // Opening the group and anchoring its row render the tool synchronously, wherever the row is.
    batch(() => {
      setToolOpen(
        found.group.type === "context"
          ? { [`context:${key}`]: true, [`${key}:tool:${found.partID}`]: true }
          : { [key]: true },
      )
      input.follow.dispatch({
        type: "anchor",
        anchor: { key: TimelineRow.key(rows()[found.index]!), partID: found.partID },
      })
    })
    // Until its ResizeObserver delivers, the opened row keeps its collapsed size, so the timeline may not scroll yet
    // or ends above the tool. Commit the real size first.
    const opened = virtualContent?.querySelector<HTMLElement>(`[data-index="${found.index}"]`)

    if (opened) resizeItem(found.index, opened.offsetHeight)
    pinAnchor()

    return true
  }

  // Puts the anchored row's top edge at its scroll margin, just below the headers that stick above it. Its own
  // growth extends downward, so only size changes at or above its row can move it; each of those calls this again.
  function pinAnchor() {
    const anchor = input.follow.anchor()
    const root = listRoot()

    if (!anchor || !root || !active()) return

    if (!rowByKey().has(anchor.key)) return input.follow.dispatch({ type: "release" })
    const row = virtualContent?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(anchor.key)}"]`)

    // A row that has not mounted yet pins once its first measurement lands.
    if (!row) return

    // A tool inside a group of several names them all on the group; pin the group, or else the row.
    const element =
      row.querySelector<HTMLElement>(`[data-timeline-part-id="${CSS.escape(anchor.partID)}"]`) ??
      [...row.querySelectorAll<HTMLElement>("[data-timeline-part-ids]")].find((group) =>
        group.dataset.timelinePartIds!.split(",").includes(anchor.partID),
      ) ??
      row

    const offset = Math.min(
      root.scrollHeight - root.clientHeight,
      Math.max(
        0,
        root.scrollTop +
          element.getBoundingClientRect().top -
          root.getBoundingClientRect().top -
          parseFloat(getComputedStyle(element).scrollMarginTop),
      ),
    )

    // Hand over every pin, even one the scroll already reaches: TanStack lands exactly on its last target once the
    // scroll is within a pixel of it, which would undo a compensation for a row above that resized since.
    virtualizer.scrollToOffset(offset)
  }

  // An anchored row that leaves the list lets its anchor go. Reads the rows only while anchored, never while scrolling.
  createEffect(() => {
    const anchor = input.follow.anchor()

    if (anchor && active() && !rowByKey().has(anchor.key)) input.follow.dispatch({ type: "release" })
  })

  function prepareNavigation() {
    input.follow.dispatch({ type: "release" })
    flushTouchAdjustment()
  }

  function flushTouchAdjustment() {
    touchAdjustment = 0
    const adjustment = rendering.scrollAdjustment
    const root = listRoot()

    if (!adjustment || !root) return
    // Transfer the translation into the native offset in the same paint.
    batch(() => {
      setRendering("scrollAdjustment", 0)

      if (virtualContent) virtualContent.style.height = `${virtualizer.getTotalSize()}px`
      elementScroll(Math.max(0, root.scrollTop + adjustment), {}, virtualizer)
    })
  }

  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )

  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => String(item.key)))

  createEffect(() => {
    if (!active()) return
    const root = listRoot()

    if (root) input.setScrollRef(root)
    input.setVisibleRef?.(visibleArea())
    queueMicrotask(() => {
      if (!active() || !root?.isConnected) return
      // A detached view can miss its nonzero ResizeObserver delivery. Publish
      // its real viewport before restoring the offset and admitting rows.
      reportRect?.({ width: root.offsetWidth, height: root.offsetHeight })

      // A route can open this timeline on a tool call, e.g. a shell picked from inside a subagent, instead of its end.
      // It is attempted once per history entry: a call that is not in the list is not looked for again on reattach.
      const reveal = input.reveal?.pending()
      const revealed = !!reveal && revealPart(reveal.target)

      if (reveal) input.reveal?.consume(reveal.entryKey)

      if (!revealed && input.follow.following()) virtualizer.scrollToEnd()

      reportOffset?.(root.scrollTop, false)
      dispatchCold(CHECK_REQUESTED)
    })
    input.setRevealMessage?.((id, partID) => {
      if (!active()) return

      const partIndex = partID
        ? rows().findIndex(
            (row) =>
              Predicate.isTagged(row, "AssistantPart") && row.group.type === "part" && row.group.ref.partID === partID,
          )
        : -1

      const promptIndex = rows().findIndex((row) => Predicate.isTagged(row, "UserMessage") && row.userMessageID === id)

      const index =
        partIndex >= 0 ? partIndex : promptIndex >= 0 ? promptIndex : input.projection.messageRowIndex().get(id)

      if (index === undefined) return
      prepareNavigation()
      virtualizer.scrollToIndex(index, { align: partIndex >= 0 ? "center" : "start" })
    })
    input.setScrollToEnd?.((behavior) => {
      const root = listRoot()

      if (!active() || !root?.isConnected) return
      flushTouchAdjustment()
      input.follow.dispatch({ type: "follow" })

      // Glide only the final screen. Crossing the whole history smoothly would stream every row through the virtualizer.
      if (behavior === "smooth")
        virtualizer.scrollToOffset(Math.max(root.scrollTop, root.scrollHeight - root.clientHeight * 2))
      virtualizer.scrollToEnd({ behavior })
    })
    input.setPage?.((direction) => {
      const root = listRoot()

      if (!active() || !root?.isConnected) return
      prepareNavigation()
      input.onUserScroll(root)
      dispatchIntent(direction < 0)
      // Like the timeline's own PageUp: 80% of a page, measured above the composer that covers its bottom. The scroll
      // event then pins at the end or loads older history near the top, as a wheel scroll does.
      virtualizer.scrollToOffset(root.scrollTop + direction * (visibleArea()?.clientHeight || root.clientHeight) * 0.8)
    })
  })

  createEffect(
    on(
      bottomInset,
      () => {
        const root = listRoot()

        if (active() && root?.isConnected) reportRect?.({ width: root.offsetWidth, height: root.offsetHeight })
      },
      { defer: true },
    ),
  )

  // The content is as tall as the rows the virtualizer sizes, so it reports that height rather than the session
  // observing the element. A ResizeObserver there sees the height a row's own observer commits during its delivery, and
  // Chrome reports every such frame as "ResizeObserver loop completed with undelivered notifications."
  createEffect(
    on([active, () => virtualizer.getTotalSize() - rendering.scrollAdjustment], () => {
      if (active()) input.onContentResize()
    }),
  )

  // Only the viewport carries the inset as a variable, for its fade and scroll padding. The variable does not inherit
  // (see index.css): the inset changes on every frame while the composer region grows, and an inherited variable would
  // restyle every rendered row each time.
  createEffect(() => listRoot()?.style.setProperty("--session-timeline-inset", `${bottomInset()}px`))

  let contentObserver: MutationObserver | undefined
  let viewportObserver: ResizeObserver | undefined
  let revealTimer: ReturnType<typeof setTimeout> | undefined

  // Within the zoom slack only a write finds the end the browser reaches: one that does not move proves the view is
  // already there, and one that does is undone before anything paints.
  function atReachableEnd(root: HTMLDivElement) {
    const top = root.scrollTop
    const distance = root.scrollHeight - root.clientHeight - top

    if (distance <= END_EPSILON) return true

    if (distance > ZOOM_SLACK) return false
    root.scrollTop = root.scrollHeight

    if (root.scrollTop === top) return true
    root.scrollTop = top

    return false
  }

  // Returns whether the view now rests at its end with that offset reported.
  const pinColdBottom = () => {
    if (!active()) return false
    const root = listRoot()

    if (!input.follow.following() || !virtualContent || !root) return false
    // scrollToEnd computes its target from the DOM, not the new size cache.
    virtualContent.style.height = `${virtualizer.getTotalSize()}px`

    if (!atReachableEnd(root)) virtualizer.scrollToEnd()

    // Report after core size adjustments finish so they cannot apply a delta
    // twice. This avoids waiting a frame for the native scroll event.
    if (virtualizer.scrollOffset !== root.scrollTop) reportOffset?.(root.scrollTop, false)

    return true
  }

  const pendingMeasurements = () => {
    const items = virtualizer.getVirtualItems()

    return (
      (rows().length > 0 && items.length === 0) ||
      items.some((item) => !virtualizer.elementsCache.get(item.key)?.isConnected)
    )
  }

  // The machine decides; this only runs what it asks for. Its state is set before any effect runs, so a check
  // requested again from inside a pin joins the running one.
  function dispatchCold(event: ColdMountEvent) {
    const current = untrack(coldMount)
    const next = transitionColdMount(current, event)

    if (next.state !== current) setColdMount(next.state)
    next.effects.forEach(runColdEffect)
  }

  function runColdEffect(effect: ColdMountEffect) {
    if (effect.type === "observe") {
      if (!virtualContent) return
      contentObserver = new MutationObserver(() => dispatchCold(CHECK_REQUESTED))
      contentObserver.observe(virtualContent, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-markdown-ready"],
      })
      viewportObserver = new ResizeObserver(() => dispatchCold(CHECK_REQUESTED))
      const root = listRoot()

      if (root) viewportObserver.observe(root)

      return
    }

    if (effect.type === "timer.start") {
      clearTimeout(revealTimer)
      revealTimer = setTimeout(() => dispatchCold({ type: "timeout", attempt: effect.attempt }), COLD_REVEAL_TIMEOUT)

      return
    }

    if (effect.type === "timer.cancel") {
      clearTimeout(revealTimer)

      return
    }

    if (effect.type === "check.schedule") {
      queueMicrotask(() => dispatchCold({ type: "check.ready", attempt: effect.attempt }))

      return
    }

    if (effect.type === "check.sample") {
      dispatchCold({ type: "check.sampled", attempt: effect.attempt, sample: sampleColdMount() })

      return
    }

    // The fallback reveals whatever has rendered, at the end a pinned view follows.
    if (effect.type === "pin") {
      pinColdBottom()

      return
    }

    clearTimeout(revealTimer)
    contentObserver?.disconnect()
    viewportObserver?.disconnect()
  }

  function sampleColdMount(): ColdMountSample {
    const root = listRoot()

    if (!virtualContent?.isConnected || !root || virtualContent.querySelector(pendingMarkdown) || !root.clientHeight)
      return "waiting"
    // Markdown can finish before ResizeObserver delivers its new box. The
    // normal measureElement path skips reads while scrolling; this gate needs
    // current boxes before expanding the estimated range or revealing it.
    virtualizer.elementsCache.forEach((element) => {
      if (element.isConnected) virtualizer.resizeItem(virtualizer.indexFromElement(element), element.offsetHeight)
    })

    if (pendingSizes.size || pendingMeasurements()) return "waiting"
    const pinned = input.follow.following()

    // A pinned view rests at the end pinColdBottom reaches. Under page zoom that end can be more than a pixel short
    // of scrollHeight - clientHeight, and TanStack keeps the offset it wrote rather than the one reached. Waiting
    // for either distance to close never ends: each pass reported the offset again, which queued the next pass as
    // a microtask, and the renderer froze.
    if (pinned && !pinColdBottom()) return "waiting"

    // The scroll event must update the range before newly exposed rows can reveal.
    if (
      !pinned &&
      root.scrollHeight > root.clientHeight &&
      Math.abs((virtualizer.scrollOffset ?? 0) - root.scrollTop) > 1
    )
      return "waiting"

    if (pendingSizes.size || pendingMeasurements() || virtualContent.querySelector(pendingMarkdown)) return "pinned"

    return "settled"
  }

  onMount(() => dispatchCold({ type: "mounted", active: active() }))
  createEffect(
    on(
      active,
      (value) => {
        dispatchCold(value ? ACTIVATED : DEACTIVATED)

        if (value) return
        // A view that goes inactive mid-touch never sees its finger lift; its translation would outlive the gesture.
        clearTouchTarget()
        flushTouchAdjustment()
        setRendering("scrollAdjustment", 0)

        if (input.sessionKey() === ownerSessionKey) input.follow.dispatch(CONTACT_LOST_EVENT)
      },
      { defer: true },
    ),
  )

  let measuredSessionKey = input.sessionKey()
  createEffect(() => {
    const key = input.sessionKey()

    if (measuredSessionKey !== key) {
      measuredSessionKey = key
      virtualizer.measure()
    }
  })

  const bindListRoot = (root: HTMLDivElement) => {
    if (root === listRoot()) return
    // TanStack owns anchoring; browser scroll anchoring would fight its adjustments.
    root.style.overflowAnchor = "none"
    setListRoot(root)
    scrollTop = root.scrollTop
    maxScroll = root.scrollHeight - root.clientHeight

    if (active()) input.setScrollRef(root)
    viewportObserver?.observe(root)
    dispatchCold(CHECK_REQUESTED)
    // The scrollbar thumb sits beside the viewport and stops its pointerdown from propagating, so
    // listen on the ScrollView root in the capture phase: thumb drags are user scrolls too.
    const scrollView = root.parentElement

    if (!scrollView) return
    scrollView.addEventListener("pointerdown", handleListPointerDown, { capture: true })
    onCleanup(() => scrollView.removeEventListener("pointerdown", handleListPointerDown, { capture: true }))
  }

  // Upward input is the one intent geometry cannot recover: nudging up while still a pixel from
  // the end must stop following, even though the resulting position still looks like the end.
  // Only an upward intent reads the scroll range, as content that does not overflow cannot move.
  function dispatchIntent(upward: boolean) {
    const root = listRoot()
    intentEvent.upward = upward
    intentEvent.overflow = upward && !!root && root.scrollHeight - root.clientHeight > MIN_OVERFLOW
    input.follow.dispatch(intentEvent)
  }

  const handleListWheel = (event: WheelEvent) => {
    if (!active()) return
    input.onUserScroll(event.target)
    dispatchIntent(event.deltaY < 0)
  }

  const handleListTouchStart = (event: TouchEvent) => {
    clearTouchTarget()

    const touch = event.touches[0]

    if (!active() || !touch) return
    input.onUserScroll(event.target)
    lastTouchY = touch.clientY
    const root = listRoot()
    const nested = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-scrollable]") : null

    input.follow.dispatch(
      nested && nested !== root && nested.scrollHeight > nested.clientHeight ? nestedTouchStartEvent : touchStartEvent,
    )
    // Native touch events keep their original target, even when streaming or
    // virtualization detaches it. Listen there instead of relying on bubbling.
    touchTarget = event.target
    touchTarget?.addEventListener("touchmove", handleListTouchMove, { passive: true })
    touchTarget?.addEventListener("touchend", handleListTouchEnd, { passive: true })
    touchTarget?.addEventListener("touchcancel", handleListTouchEnd, { passive: true })

    if (root) reportOffset?.(root.scrollTop, virtualizer.isScrolling)
  }

  const handleListTouchMove = (event: Event) => {
    if (!(event instanceof TouchEvent)) return
    const current = event.touches[0]?.clientY

    if (current === undefined) return
    const previous = lastTouchY
    lastTouchY = current

    // A retained target can outlive its whole session view. Only the active timeline may change the shared follow
    // state, and only while the finger it started with is still down; release still cleans up below.
    if (!active() || !isTouchHeld(input.follow.peek())) return

    // Dragging the content downward reveals earlier messages.
    if (current <= previous) return
    const root = listRoot()
    touchDragEvent.overflow = !!root && root.scrollHeight - root.clientHeight > MIN_OVERFLOW
    input.follow.dispatch(touchDragEvent)
  }

  const handleListTouchEnd = () => {
    clearTouchTarget()
    touchAdjustment = 0

    if (!active()) return
    input.follow.dispatch(virtualizer.isScrolling ? touchMomentumEvent : touchEndEvent)

    if (!virtualizer.isScrolling) flushTouchAdjustment()
  }

  function clearTouchTarget() {
    touchTarget?.removeEventListener("touchmove", handleListTouchMove)
    touchTarget?.removeEventListener("touchend", handleListTouchEnd)
    touchTarget?.removeEventListener("touchcancel", handleListTouchEnd)
    touchTarget = null
  }

  onCleanup(clearTouchTarget)

  // Drag-selecting past the edge and dragging the scrollbar both scroll without a wheel or key,
  // so a held pointer is what separates those from the virtualizer's own measurement adjustments.
  // Not the secondary button: it opens a context menu that can swallow its release. The middle button stays, as its
  // drag autoscrolls on Windows and Linux.
  const handleListPointerDown = (event: PointerEvent) => {
    if (!active() || event.button === 2) return
    input.onUserScroll(event.target)
    input.follow.dispatch(pointerDownEvent)
  }

  // A release only ends a pointer gesture, so every view may report it, including one that went inactive mid-press.
  // On touch devices it also fires beside touchend, which owns the touch gesture.
  const releasePointer = () => input.follow.dispatch(pointerUpEvent)

  // A window that loses focus or hides mid-press may never see the release, of a pointer or of a finger. Every view may
  // report it, as the window lost all contact.
  const loseContact = () => {
    clearTouchTarget()
    touchAdjustment = 0

    if (active()) flushTouchAdjustment()
    input.follow.dispatch(CONTACT_LOST_EVENT)
  }

  const loseHiddenContact = () => {
    if (document.visibilityState === "hidden") loseContact()
  }

  onMount(() => {
    window.addEventListener("pointerup", releasePointer)
    window.addEventListener("pointercancel", releasePointer)
    window.addEventListener("blur", loseContact)
    document.addEventListener("visibilitychange", loseHiddenContact)
  })
  onCleanup(() => {
    window.removeEventListener("pointerup", releasePointer)
    window.removeEventListener("pointercancel", releasePointer)
    window.removeEventListener("blur", loseContact)
    document.removeEventListener("visibilitychange", loseHiddenContact)
  })

  const handleListKeyDown = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    const key = scrollKey(event)

    if (!key) return

    if (!isScrollKeyTarget(event.target, key)) return

    if (scrollKeyOwner(event.currentTarget, event.target, key) !== event.currentTarget) return
    input.onUserScroll(event.currentTarget)
    dispatchIntent(upwardKeys.has(key))
  }

  const handleListScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (!active()) return
    const root = event.currentTarget
    scrollEvent.previousTop = scrollTop
    scrollEvent.previousMaxScroll = maxScroll
    scrollTop = root.scrollTop
    maxScroll = root.scrollHeight - root.clientHeight
    scrollEvent.scrollTop = scrollTop
    scrollEvent.maxScroll = maxScroll
    input.follow.dispatch(scrollEvent)
    dispatchCold(CHECK_REQUESTED)
    input.onScheduleScrollState(root)
    input.onHistoryScroll()
  }

  function View(props: ViewProps) {
    function VirtualRow(rowProps: { rowKey: string }) {
      let element: HTMLDivElement
      const initialItem = virtualItemByKey().get(rowProps.rowKey)!
      const initialRow = rowByKey().get(rowProps.rowKey)!
      const item = createMemo(() => virtualItemByKey().get(rowProps.rowKey) ?? initialItem)
      const row = createMemo(() => rowByKey().get(rowProps.rowKey) ?? rows()[item().index] ?? initialRow)
      const [ready, setReady] = createSignal(initialItem.size <= fallbackItemSize || !props.deferred(initialRow))
      let contentMeasureFrame: number | undefined

      onMount(() => virtualizer.measureElement(element))
      // Prepending history changes data-index, not the keyed element's identity.
      // Its observer reads the current index and delivers any actual size change.
      onCleanup(() => {
        if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
        queueMicrotask(() => virtualizer.measureElement(null))
      })

      return (
        <div
          data-timeline-key={rowProps.rowKey}
          style={{
            position: "absolute",
            top: `${item().start - topOffset() - rendering.scrollAdjustment}px`,
            left: "0",
            width: "100%",
            height: `${item().size}px`,
            overflow: "clip",
            "overflow-clip-margin": Predicate.isTagged(row(), "TurnGap") ? undefined : "0.5px",
          }}
        >
          <div
            ref={(value) => {
              element = value

              if (
                !Predicate.isTagged(row(), "UserMessage") ||
                !addedKeys.has(rowProps.rowKey) ||
                !input.follow.following() ||
                coldHidden()
              )
                return
              // The optimistic row can paint before ResizeObserver corrects the tail estimates.
              // Measure the mounted tail and pin it in this render's microtask instead.
              queueMicrotask(() => {
                if (!input.follow.following() || !virtualContent?.isConnected) return
                virtualizer.elementsCache.forEach((item) => {
                  if (item.isConnected) virtualizer.resizeItem(virtualizer.indexFromElement(item), item.offsetHeight)
                })
                virtualizer.resizeItem(item().index, element.offsetHeight)
                virtualContent.style.height = `${virtualizer.getTotalSize()}px`
                virtualizer.scrollToEnd()
              })
            }}
            data-index={item().index}
            style={{ "min-height": ready() ? undefined : `${initialItem.size}px` }}
          >
            {props.renderRow(row, () => {
              setReady(true)

              if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
              contentMeasureFrame = requestAnimationFrame(() => {
                contentMeasureFrame = undefined

                if (active() && element.isConnected) virtualizer.measureElement(element)
              })
            })}
          </div>
        </div>
      )
    }

    return (
      <div ref={setViewRoot} class="relative w-full h-full min-w-0">
        <div
          class="absolute left-1/2 -translate-x-1/2 z-[60] pointer-events-none transition-[opacity,translate]"
          classList={{
            "opacity-100 translate-y-0 duration-150 ease-[cubic-bezier(.2,.8,.2,1)]":
              input.scroll().overflow && input.scroll().jump,
            "opacity-0 translate-y-1 motion-reduce:translate-y-0 duration-[110ms] ease-[cubic-bezier(.4,0,1,1)]":
              !input.scroll().overflow || !input.scroll().jump,
          }}
          style={{ bottom: `${bottomInset() + 32}px` }}
          inert={!input.scroll().overflow || !input.scroll().jump}
        >
          <button
            type="button"
            aria-label={language.t("session.messages.jumpToLatest")}
            class="pointer-events-auto flex items-center justify-center w-8 h-7 px-2 py-1.5 rounded-lg border-none cursor-pointer text-v2-text-text-base backdrop-blur-[2px] outline-none hover:bg-[linear-gradient(var(--v2-overlay-simple-overlay-hover),var(--v2-overlay-simple-overlay-hover))] active:bg-[linear-gradient(var(--v2-overlay-simple-overlay-pressed),var(--v2-overlay-simple-overlay-pressed))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
            style={{
              "background-color": "color-mix(in srgb, var(--v2-background-bg-base) 92%, transparent)",
              "box-shadow": "var(--v2-elevation-raised), 0px 2px 8px var(--v2-background-bg-base)",
            }}
            onClick={() => input.onResumeScroll(prefersReducedMotion() ? "auto" : "smooth")}
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
          data-slot="session-timeline-scroll"
          viewportRef={bindListRoot}
          thumbContainer={visibleArea()}
          thumbHoverTarget={viewRoot()}
          onBeforeScroll={prepareNavigation}
          verticalScrollAdjustment={rendering.scrollAdjustment}
          onWheel={handleListWheel}
          onTouchStart={handleListTouchStart}
          onKeyDown={handleListKeyDown}
          onScroll={handleListScroll}
          onClick={() => {
            // Following would scroll a selection away.
            if (window.getSelection()?.toString()) input.follow.dispatch({ type: "detach" })
          }}
          class="relative min-w-0 w-full h-full"
          style={{ "--sticky-accordion-top": input.showHeader() ? "var(--session-header-height, 48px)" : "0px" }}
        >
          <Show when={input.showHeader()} fallback={<div aria-hidden="true" class="h-4 md:hidden" />}>
            {props.header}
          </Show>
          <div
            data-timeline-virtual-content
            ref={virtualContent}
            style={{
              height: `${virtualizer.getTotalSize() - rendering.scrollAdjustment}px`,
              position: "relative",
              width: "100%",
              // Rows held wider than the timeline mid-flight don't scroll it sideways.
              "overflow-x": "clip",
              visibility: coldHidden() ? "hidden" : undefined,
            }}
          >
            <div
              ref={rowLayer}
              class="absolute inset-y-0"
              style={{
                left: "calc((100% - var(--panel-hold-width, 100%)) / 2)",
                width: "var(--panel-hold-width, 100%)",
              }}
            >
              <For each={virtualRowKeys()}>{(rowKey) => <VirtualRow rowKey={rowKey} />}</For>
            </div>
            <div
              data-timeline-row="bottom-spacer"
              class="absolute top-0 left-0 w-full"
              style={{
                height: `${tailSize()}px`,
                transform: `translateY(${virtualizer.getTotalSize() - tailSize() - rendering.scrollAdjustment}px)`,
              }}
            >
              {props.bottomSpacer}
            </div>
          </div>
          <div aria-hidden="true" data-timeline-inset class="shrink-0" style={{ height: `${bottomInset()}px` }} />
        </ScrollView>
        <div
          ref={setVisibleArea}
          data-slot="session-timeline-visible"
          class="pointer-events-none absolute inset-x-0 top-0"
          style={{ bottom: `${bottomInset()}px` }}
        />
      </div>
    )
  }

  onCleanup(() => {
    cache.delete(ownerSessionKey)
    cache.set(ownerSessionKey, {
      measurements: virtualizer.takeSnapshot(),
      toolOpen: { ...toolOpen },
      patchGroupKeys,
      presentationKey: input.presentationKey?.(),
    })

    while (cache.size > 16) cache.delete(cache.keys().next().value!)
    dispatchCold(DISPOSED)

    if (active()) {
      input.setScrollRef(undefined)
      input.setRevealMessage?.(() => {})
      input.setScrollToEnd?.(() => {})
      input.setPage?.(() => {})
    }
  })

  return {
    disclosure: {
      patchGroupKeys,
      value: (key: string) => toolOpen[key],
      set: (key: string, open: boolean) => {
        // Following the end would scroll an opened user message's top away; it stays where it was pressed.
        if (open && key.startsWith("user-expanded:")) input.follow.dispatch({ type: "detach" })
        setToolOpen(key, open)
      },
    },
    revealPart,
    View,
  }
}
