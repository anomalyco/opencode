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
import {
  readTimelineTypography,
  type TimelineLayoutEnvironment,
  type TimelineTypography,
  type TimelineRowLayout,
} from "@opencode/session-ui/timeline/text-layout"
import { useLanguage } from "@/runtime/i18n/language"
import {
  batch,
  createEffect,
  createRoot,
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
import { holdLandingWidth } from "@/shell/panel-motion"
import { observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import { motionTuning } from "@opencode/ui/motion-tuning"
import { landSendFlight, sendFlightPending } from "./send-flight"
import { arrivalFade, growthSpring, softEdge, streamingEdge, workingHandoff } from "./row-growth"
import { createTimelineMotion, type RowJump } from "./timeline-motion"

const fallbackItemSize = 60

const grid = (value: number) => Math.round(value * 64) / 64

const gridHeight = (element: Element) => grid(element.getBoundingClientRect().height)

// Reserved below the last row: a 36px lane for the live status row and its background hint, an 8px gap, then a 28px
// activity pill and its 10px composer gap. Both come and go inside it, so neither moves the rows above.
const tailSize = 82

const pendingMarkdown = '[data-component="markdown"]:not([data-markdown-ready])'

// Distance from the bottom that counts as "at the end". Deliberately tight: a collapse clamps
// exactly to the end, while a one-pixel nudge upward is a deliberate move away from it.
const endEpsilon = 0.5

const upwardKeys = new Set(["up", "page-up", "home"])

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
  projection: Projection
  showHeader: Accessor<boolean>
  layout: (row: TimelineRow.TimelineRow, environment: TimelineLayoutEnvironment) => TimelineRowLayout
  /** True while the timeline follows the newest content. Drives every anchoring decision. */
  pinned: Accessor<boolean>
  scroll: Accessor<{ overflow: boolean; jump: boolean }>
  onResumeScroll: (behavior?: ScrollBehavior) => void
  setScrollRef: (element: HTMLDivElement | undefined) => void
  setContentRef: (element: HTMLDivElement) => void
  /** Height of the composer region floating over the timeline's bottom edge, where the timeline fades out. */
  bottomInset?: Accessor<number>
  /** How much of the latest inset change was a step to ease rather than a spring to ride, as when a sent draft clears. */
  bottomInsetStep?: () => number
  setVisibleRef?: (element: HTMLDivElement | undefined) => void
  onScheduleScrollState: (
    element: HTMLDivElement,
    geometry?: { extent: number; viewport: number; offset: number },
  ) => void
  onPin: () => void
  onUnpin: () => void
  onSelectionInteraction: (event: MouseEvent) => void
  onUserScroll: (target?: EventTarget | null) => void
  onHistoryScroll: () => void
  canRenderImmediately?: (
    row: TimelineRow.TimelineRow,
    disclosure: Readonly<Record<string, boolean | undefined>>,
  ) => boolean
  setRevealMessage?: (fn: (id: string, partID?: string) => void) => void
  setRevealPart?: (fn: (target: string) => boolean) => void
  setScrollToEnd?: (fn: (behavior?: ScrollBehavior) => void) => void
  /** A tool call the route asks this timeline to open on; `done` clears it once revealed. */
  reveal?: { target: () => string | undefined; done: () => void }
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
  const ownerSessionKey = input.sessionKey()
  const entry = cache.get(ownerSessionKey)
  const cached = entry?.presentationKey === input.presentationKey?.() ? entry : undefined
  const initialMeasurements = cached?.measurements
  const coldBottomMount = !initialMeasurements?.length && input.pinned()
  const [listRoot, setListRoot] = createSignal<HTMLDivElement>()
  const [visibleArea, setVisibleArea] = createSignal<HTMLDivElement>()
  const [viewRoot, setViewRoot] = createSignal<HTMLDivElement>()
  const bottomInset = () => input.bottomInset?.() ?? 0

  const [layoutState, setLayoutState] = createStore<{
    environment?: TimelineLayoutEnvironment
    fontsReady: boolean
    viewport: number
    offset: number
    visible: boolean
  }>({ fontsReady: false, viewport: 0, offset: 0, visible: document.visibilityState !== "hidden" })

  // Each row models its own layout, so a streamed delta reruns only the row whose text it changed.
  const rowLayouts = new Map<string, { layout: Accessor<TimelineRowLayout | undefined>; dispose: () => void }>()

  const rowLayout = (key: string) => {
    const existing = rowLayouts.get(key)

    if (existing) return existing.layout()

    const created = createRoot((dispose) => {
      const layout = createMemo(
        () => {
          const environment = layoutState.environment
          const row = input.projection.rowByKey().get(key)

          return environment && row ? input.layout(row, environment) : undefined
        },
        undefined,
        { equals: sameLayout },
      )

      createEffect(
        on(layout, (value) => {
          if (!value || value.source === "dom") return
          const index = untrack(rowIndexes).get(key)

          if (index !== undefined) virtualizer.resizeItem(index, value.height)
        }),
      )

      return { layout, dispose }
    })

    rowLayouts.set(key, created)

    return created.layout()
  }

  const modelHeight = (key: string) => {
    const value = rowLayout(key)

    return value && value.source !== "dom" ? value.height : undefined
  }

  const fullyModeled = createMemo(
    () => !!layoutState.environment && rowKeys().every((key) => rowLayout(key)?.source !== "dom"),
  )

  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>(cached?.toolOpen ?? {})
  const patchGroupKeys = cached?.patchGroupKeys ?? new Map<string, string>()
  createEffect(
    on(
      () => input.presentationKey?.(),
      () => setToolOpen(reconcile({})),
      { defer: true },
    ),
  )

  const [rendering, setRendering] = createStore<{
    initialTail: boolean
    scrollAdjustment: number
    /** A revealed tool whose top edge stays put until the user scrolls. */
    anchor?: { key: string; partID: string }
  }>({ initialTail: coldBottomMount, scrollAdjustment: 0 })

  const rows = input.projection.rows
  const rowByKey = input.projection.rowByKey

  const rowKeys = createMemo(() => rows().map(TimelineRow.key), undefined, {
    equals: (previous, next) => previous.length === next.length && previous.every((key, index) => key === next[index]),
  })

  const rowIndexes = createMemo(() => new Map(rowKeys().map((key, index) => [key, index])))

  const knownKeys = new Set(rowKeys())
  const addedKeys = new Set<string>()
  // Rows added after the first one already shown, at the end or among the last rows, grow in while visible.
  const arrivals = new Set<string>()
  const [leavingKeys, setLeavingKeys] = createSignal<string[]>([])
  const [reach, setReach] = createSignal(0)
  const leavingCleanups = new Map<string, (revive?: boolean) => void>()
  const rowBoxes = new Map<string, () => { top: number; bottom: number }>()

  let listedKeys = rowKeys()

  const getItemKey = createMemo(() => {
    const keys = rowKeys()
    const previous = listedKeys
    listedKeys = keys

    // Snapshot before the virtualizer sees insertions or removals too: a departing Working row closes a real gap.
    if (previous !== keys)
      untrack(() => {
        capture(virtualizer.measurementsCache.filter((item) => virtualizer.elementsCache.has(item.key)))
        scheduleCommit()
      })
    const head = keys.findIndex((key) => knownKeys.has(key))
    keys.forEach((key, index) => {
      // A row that returns during its exit still has its identity and running motion; it is not a new arrival.
      if (leavingCleanups.has(key)) knownKeys.add(key)
      leavingCleanups.get(key)?.(true)

      if (knownKeys.has(key)) return
      knownKeys.add(key)
      addedKeys.add(key)

      if (head < 0 || index > head) arrivals.add(key)
    })
    closeRemoved(previous, keys)

    return (index: number) => keys[index] ?? `removed:${index}`
  })

  const rangeExtractor = createMemo(() => {
    const id = input.projection.activeMessageID()
    const active = id ? (input.projection.messageLastRowIndex().get(id) ?? -1) : -1
    const initialTail = rendering.initialTail && input.pinned()
    const anchored = rendering.anchor ? rowKeys().indexOf(rendering.anchor.key) : -1
    const activity = rowKeys().lastIndexOf("activity")
    const reached = reach()

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
        [
          ...new Set([
            ...indexes,
            ...reachedIndexes(range, reached),
            ...[active, anchored, activity].filter((index) => index >= 0),
          ]),
        ].sort((a, b) => a - b),
        range.count,
      )
    }
  })

  const measuredElements = new WeakSet<Element>()
  const observedElements = new WeakSet<Element>()
  let touchStart: number | undefined
  let touchTarget: EventTarget | null = null
  let touchNested = false
  let touchScrolling = false
  let touchAdjustment = 0
  let pointerHeld = false
  let userScrollAt = -Infinity
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
  let reportOffset: ((offset: number, scrolling: boolean) => void) | undefined
  let reportRect: ((rect: { width: number; height: number }) => void) | undefined
  // The list root's last observed size; the composer region moving its edge does not resize it.
  let rootRect: { width: number; height: number } | undefined
  let batchingColdSizes = false
  let coldPending = coldBottomMount
  // The whole-pixel offset last written, while a translate draws the fraction it dropped.
  let wholeTop: number | undefined
  // The exact offset the rows are drawn at.
  let drawnTop = 0
  // Sizes held back from rows still streaming, applied once their text completes.
  const shrinks = new Map<string, number>()

  // The session header is a fixed 48px, the same fallback --sticky-accordion-top uses.
  const headerHeight = 48

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return rows().length
    },
    getScrollElement: () => listRoot() ?? null,
    // The viewport runs on under the composer region. The virtualizer sees only the part above it, which the
    // inset spacer below the rows keeps consistent with the native scroll range.
    observeElementRect: (instance, callback) => {
      reportRect = (rect) => {
        callback({ width: rect.width, height: Math.max(0, rect.height - bottomInset()) })
      }

      return observeElementRect(instance, (rect) => {
        const resized = rootRect !== undefined && (rootRect.width !== rect.width || rootRect.height !== rect.height)
        rootRect = rect
        setLayoutState("viewport", rect.height)
        const environment = layoutState.environment

        if (environment && Math.abs(environment.width - rect.width) >= 1) {
          // A side panel animates the column's width every frame. Rows keep their heights until the width settles,
          // then re-measure once, instead of rewrapping every row on every frame.
          if (coldPending) setLayoutState("environment", { width: rect.width, desktop: isDesktop() })
          else holdWidth()
        }

        if (!active()) return
        reportRect?.(rect)

        // A viewport resize changes the DOM gap without changing the reader's intent. Restore the followed end
        // before the next growth frame tests that gap; otherwise a smaller viewport strands every later append.
        if (resized && input.pinned())
          queueMicrotask(() => {
            if (active() && input.pinned()) pinEnd()
          })
      })
    },
    // Route navigation detaches and reattaches the scroll element, which drops its offset.
    observeElementOffset: (instance, callback) => {
      reportOffset = (offset, scrolling) => {
        if (!active()) return
        setLayoutState("offset", offset)
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
            (logicalOffset <= 0 || offset <= 0 || (touchStart !== undefined && offset <= layoutState.viewport))
          )
            flushTouchAdjustment()

          if (!scrolling && touchStart === undefined) finishTouchScroll()
        })
        settleColdBottom()
      }

      return observeElementOffsetReconnectAware(instance, reportOffset, () => {
        if (!active()) return
        virtualContent?.querySelectorAll<HTMLDivElement>("[data-index]").forEach(virtualizer.measureElement)

        if (input.pinned()) pinEnd()
        settleColdBottom()
      })
    },
    initialOffset: () => (input.pinned() ? Number.MAX_SAFE_INTEGER : 0),
    initialMeasurementsCache: initialMeasurements,
    // Visible arrivals start empty even when unpinned, so their first measurement is the change that reveals them.
    estimateSize: (index) =>
      arrivals.has(getItemKey()(index)) && active() && layoutState.visible && !coldPending
        ? 0
        : (modelHeight(getItemKey()(index)) ?? fallbackItemSize),
    // A newly observed element gets a real ResizeObserver box before paint. Reuse
    // its snapshot on attachment, but later explicit measurements must read layout
    // so deferred/rewrapped content cannot keep stale, clipped heights (TanStack/virtual#1183).
    measureElement: (element, entry, instance) => {
      const model = modelHeight(rowKeys()[instance.indexFromElement(element)]!)

      if (model !== undefined) {
        const first = !observedElements.has(element)
        observedElements.add(element)

        if (coldPending && first) settleColdBottom()

        return model
      }

      if (!active() || !element.isConnected)
        return (
          instance.itemSizeCache.get(instance.options.getItemKey(instance.indexFromElement(element))) ??
          fallbackItemSize
        )
      const initial = !measuredElements.has(element)
      measuredElements.add(element)
      const box = entry?.borderBoxSize[0]

      if (box) {
        const first = !observedElements.has(element)
        observedElements.add(element)

        if (coldPending && first) settleColdBottom()

        return grid(box.blockSize)
      }

      if (initial) {
        const size = instance.itemSizeCache.get(instance.options.getItemKey(instance.indexFromElement(element)))

        if (size !== undefined || coldPending) return size ?? fallbackItemSize
      }

      return gridHeight(element)
    },
    scrollToFn: (offset, options, instance) => {
      if (!active()) return

      if (batchingColdSizes && input.pinned()) return
      setRendering("scrollAdjustment", 0)

      if (virtualContent) virtualContent.style.height = `${instance.getTotalSize()}px`
      const root = listRoot()

      if (root && options.behavior !== "smooth")
        return writeScroll(root, offset + (options.adjustments ?? 0), instance.getTotalSize())
      clearRemainder()
      elementScroll(offset, options, instance)
    },
    get getItemKey() {
      return getItemKey()
    },
    get anchorTo() {
      return input.pinned() && !following() ? "end" : "start"
    },
    get followOnAppend() {
      // Animated growth owns the followed offset. A second scroll-to-end here
      // uses the previous DOM range while optimistic rows are still measuring.
      return input.pinned() && !following()
    },
    scrollEndThreshold: 80,
    get scrollMargin() {
      // Empty projections still need the bottom spacer for running status.
      return rows().length > 0 ? topOffset() : 0
    },
    paddingEnd: tailSize,
    // Revealed prompts sit below the solid header and its 16px fade.
    get scrollPaddingStart() {
      return input.showHeader() ? headerHeight + 16 : 0
    },
    get rangeExtractor() {
      return rangeExtractor()
    },
  })

  const resizeItem = virtualizer.resizeItem

  function rowHeight(element: HTMLDivElement) {
    return modelHeight(rowKeys()[virtualizer.indexFromElement(element)]!) ?? gridHeight(element)
  }

  const scrollGeometry = createMemo(() => ({
    extent: Math.max(
      layoutState.viewport,
      topOffset() + virtualizer.getTotalSize() + bottomInset() - rendering.scrollAdjustment,
    ),
    viewport: layoutState.viewport,
    offset: layoutState.offset,
    track: Math.max(0, layoutState.viewport - bottomInset()),
  }))

  const endOffset = () => Math.max(0, scrollGeometry().extent - scrollGeometry().viewport)
  const contentHeight = () => virtualizer.getTotalSize() - rendering.scrollAdjustment

  createEffect(() => {
    const keys = new Set(rowKeys())
    keys.forEach((key) => untrack(() => rowLayout(key)))
    rowLayouts.forEach((value, key) => {
      if (keys.has(key)) return
      value.dispose()
      rowLayouts.delete(key)
    })
  })
  onCleanup(() => rowLayouts.forEach((value) => value.dispose()))

  // How far each revealing row's box reaches past its slot while its soft edge runs.
  const [edgeReach, setEdgeReach] = createStore<Record<string, number | undefined>>({})

  const motion = createTimelineMotion({
    layer: () => rowLayer,
    spring: growthSpring,
    timeScale: motionTuning.timeScale,
    // Coarse and only growing while motion runs, so a stream's every commit does not reshape the mounted range.
    onReach: (px) => setReach((current) => (px > 0 ? Math.max(current, Math.ceil(px / 256) * 256) : 0)),
    onEdge: (key, px) => setEdgeReach(key, px || undefined),
  })

  // Where every mounted row rested on screen before the content changed, so the change can be drawn as a move from there.
  let before: { top: number; rows: Map<string, { top: number; bottom: number }> } | undefined
  let commitQueued = false
  let disclosing = false
  // The row Working hands its place to as it leaves; its new footer shows at once for the copy button to sharpen into.
  let handoffRow: string | undefined

  function capture(items?: VirtualItem[]) {
    if (before || !canAnimate()) return
    untrack(() => {
      before = {
        top: drawnTop,
        rows: new Map([
          ...(items ?? virtualizer.getVirtualItems()).map((item) => {
            const top = item.start - drawnTop - rendering.scrollAdjustment

            return [String(item.key), { top, bottom: top + item.size }] as const
          }),
          // Leaving rows keep their frozen slots outside TanStack's measurement list until their exit finishes.
          ...leavingKeys().flatMap((key) => {
            const box = rowBoxes.get(key)?.()

            if (!box) return []
            const offset = topOffset() - drawnTop

            return [[key, { top: box.top + offset, bottom: box.bottom + offset }] as const]
          }),
        ]),
      }
    })
  }

  function scheduleCommit() {
    if (commitQueued) return
    commitQueued = true
    queueMicrotask(commit)
  }

  // One content change: rows take their final sizes, the followed end its final offset, and then the change is drawn.
  function commit() {
    commitQueued = false

    if (!active()) {
      before = undefined
      pendingSizes.clear()

      return
    }

    const sizes = [...pendingSizes]
    pendingSizes.clear()

    const apply = (entries: [string, number][]) => {
      // The hidden pinned mount needs one bottom write after the whole batch,
      // not a layout-forcing scroll adjustment for every measured row.
      batchingColdSizes = coldPending && input.pinned()
      batch(() =>
        entries.forEach(([key, size]) => {
          const index = rowIndexes().get(key)

          if (index === undefined) return
          commitSize(index, key, size)
          applyTouchAdjustment()
        }),
      )
      batchingColdSizes = false
    }

    // A DOM row's first measurement corrects the estimate it mounted at, which never painted, so it lands before the
    // snapshot and nothing is drawn moving from it. Arrivals mount empty on purpose; their measurement reveals them.
    const corrections = sizes.filter(
      ([key]) => !virtualizer.itemSizeCache.has(key) && !arrivals.has(key) && modelHeight(key) === undefined,
    )

    const changes = sizes.filter((entry) => !corrections.includes(entry))

    apply(corrections)
    capture()
    // An uncached row's size is its estimate, which is its model. Once the first resize below remeasures, every other
    // row would take its new model height silently, with no delta to anchor. Pin what each shows first.
    changes.forEach(([key]) => {
      const index = rowIndexes().get(key)
      const shown = index === undefined ? undefined : virtualizer.measurementsCache[index]?.size

      if (shown !== undefined && !virtualizer.itemSizeCache.has(key)) virtualizer.itemSizeCache.set(key, shown)
    })
    apply(changes)
    pinAnchor()

    if (coldPending) pinColdBottom()
    settleColdBottom()

    if (coldPending) {
      before = undefined

      return
    }

    // Reopening a settled scroll-to-end operation can fight subsequent keyboard scrolling.
    if (input.pinned() && (following() || Math.abs(endOffset() - layoutState.offset) > endEpsilon)) pinEnd()

    // Reduced motion may have turned on since the snapshot, with rows still moving from earlier changes.
    if (prefersReducedMotion()) {
      before = undefined
      handoffRow = undefined
      motion.cancel()

      return fadeArrivals()
    }

    draw()
  }

  // Reduced motion moves nothing; arriving rows only fade in where they rest.
  function fadeArrivals() {
    if (!layoutState.visible) return arrivals.clear()
    virtualizer.getVirtualItems().forEach((item) => {
      const key = String(item.key)

      // One still at its empty estimate fades in with the commit that measures it.
      if (item.size <= 0 || !arrivals.delete(key) || Predicate.isTagged(rows()[item.index], "TurnGap")) return
      virtualizer.elementsCache.get(key)?.parentElement?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: arrivalFade() * 1000,
        easing: "ease-out",
      })
    })
    settleArrivals()
  }

  // Rows already rest at their new slots. Each is drawn from where it was on screen and springs into place: the shared
  // move on the row layer, the rest per row, and a row's new part revealed under a clip.
  function draw() {
    const previous = before
    before = undefined
    const handoff = handoffRow
    handoffRow = undefined

    if (!previous) return settleArrivals()
    const layer = following() ? drawnTop - previous.top : 0

    // A commit that moves the followed end a whole screen, like a finished reply arriving in one update, leaves
    // nothing on screen to carry: the rows rest at once and what arrived only fades in. Rows that only grew keep growing.
    if (!disclosing && arrivals.size > 0 && Math.abs(layer) >= layoutState.viewport - bottomInset()) {
      motion.cancel()

      return fadeArrivals()
    }

    if (!canAnimate()) {
      settleArrivals()

      return motion.cancel()
    }

    const keys = rowKeys()

    const jumps = virtualizer.getVirtualItems().flatMap((item): RowJump[] => {
      const key = String(item.key)
      const inner = virtualizer.elementsCache.get(key)
      const wrapper = inner?.parentElement
      const row = rows()[item.index]

      if (!inner?.isConnected || !wrapper || !row) return []
      // A held touch's pending adjustment already keeps rows where they were drawn; it is not a jump.
      const top = item.start - drawnTop - rendering.scrollAdjustment
      const bottom = top + item.size
      // An arrival still at its empty estimate is revealed by the commit that measures it.
      const arriving = item.size > 0 && arrivals.delete(key)
      const was = previous.rows.get(key) ?? (arriving ? arrivedAt(previous.rows, keys, item.index) : undefined)

      if (!was) return []
      const content = was.top - top - layer
      const box = key !== handoff ? Math.min(content, was.bottom - bottom - layer) : content
      const enter = arriving && !Predicate.isTagged(row, "TurnGap") ? item.size : undefined

      // The anchored tool already holds still on screen, however its row changed around it.
      const hold =
        key === rendering.anchor?.key ||
        (Predicate.isTagged(row, "UserMessage") && sendFlightPending(row.userMessageID))

      if (!hold && enter === undefined && Math.abs(content) < 1 / 64 && Math.abs(content - box) < 1 / 64) return []

      return [{ key, wrapper, inner, box, content, edge: streaming(row) ? streamingEdge : softEdge, enter, hold }]
    })

    settleArrivals()

    if (handoff) handOff(handoff)

    if (Math.abs(layer) >= 1 / 64 || jumps.length) {
      motion.kick(layer, jumps, disclosing ? 0.18 : undefined)
      disclosing = false
    }
  }

  // Arrivals measured without being drawn arriving, or outside the drawn range, have arrived out of view. One that never
  // mounted takes its modelled height in place of its empty estimate, and mounts later like any row.
  function settleArrivals() {
    const drawn = new Set(virtualizer.getVirtualItems().map((item) => String(item.key)))
    arrivals.forEach((key) => {
      if (!virtualizer.itemSizeCache.has(key) && drawn.has(key)) return
      arrivals.delete(key)
      const index = rowIndexes().get(key)

      if (index === undefined || virtualizer.itemSizeCache.has(key)) return
      resizeItem(index, modelHeight(key) ?? fallbackItemSize)
      // Uncached, its first DOM measurement still corrects an estimate that never painted.
      virtualizer.itemSizeCache.delete(key)
    })
  }

  // Rows within `reached` px of the range stay mounted while the layer draws them away from their slots.
  function reachedIndexes(range: Range, reached: number): number[] {
    if (reached <= 0) return []
    const items = virtualizer.measurementsCache
    const top = (items[range.startIndex]?.start ?? 0) - reached
    const bottom = (items[range.endIndex]?.end ?? 0) + reached

    return [
      ...items.slice(0, range.startIndex).filter((item) => item.end > top),
      ...items.slice(range.endIndex + 1).filter((item) => item.start < bottom),
    ].map((item) => item.index)
  }

  // An arriving row was nowhere before; it opens from the seam it arrives in, at zero height.
  function arrivedAt(drawn: Map<string, { top: number; bottom: number }>, keys: string[], index: number) {
    const above = keys.slice(0, index).findLast((key) => drawn.has(key))

    if (above) return { top: drawn.get(above)!.bottom, bottom: drawn.get(above)!.bottom }
    const below = keys.slice(index + 1).find((key) => drawn.has(key))

    if (below) return { top: drawn.get(below)!.top, bottom: drawn.get(below)!.top }
  }

  function pinEnd() {
    const root = listRoot()

    if (root) writeScroll(root, endOffset())
  }

  // Native scroll offsets snap to whole pixels. Each write takes the whole pixel below and draws the rest as a
  // translate, so row edges stay on the 1/64 px grid instead of trembling with the rounding.
  // TanStack scrolls to compensate a resize before it notifies Solid, so `scrollToFn` passes its instance's total
  // size; the reactive one still holds the size from before the resize.
  function writeScroll(root: HTMLDivElement, offset: number, total = virtualizer.getTotalSize()) {
    const nextHeight = total - rendering.scrollAdjustment
    const extent = Math.max(layoutState.viewport, topOffset() + nextHeight + bottomInset())
    const exact = Math.max(0, Math.min(offset, extent - layoutState.viewport))
    const previous = wholeTop
    const whole = Math.floor(exact)
    drawnTop = exact
    // Commit the extent before the offset, without asking layout to rediscover either value.
    const resized = virtualContent && Math.abs((parseFloat(virtualContent.style.height) || 0) - nextHeight) > 0.02

    if (resized && virtualContent) virtualContent.style.height = `${nextHeight}px`
    const write = resized || previous === undefined || Math.round(previous) !== whole

    if (write) root.scrollTop = whole
    // Page zoom keeps the offset on the zoomed pixel grid, a fraction off the whole pixel; the translate draws the rest
    // from where it landed. Further off is a clamp, which the scroll handler re-pins.
    const stored = write ? root.scrollTop : previous!
    wholeTop = Math.abs(stored - whole) < 1 ? stored : whole
    scrollTop = wholeTop
    setLayoutState("offset", wholeTop)

    if (virtualizer.scrollOffset !== wholeTop) reportOffset?.(wholeTop, false)
    untrack(() => input.onScheduleScrollState(root, { ...scrollGeometry(), extent }))

    if (wholeTop === exact) return virtualContent?.style.removeProperty("translate")
    virtualContent?.style.setProperty("translate", `0 ${wholeTop - exact}px`)
  }

  function clearRemainder() {
    wholeTop = undefined
    virtualContent?.style.removeProperty("translate")
  }

  // Lands every moving row where it rests, at once.
  function settleMotion() {
    shrinks.forEach((size, key) => {
      const index = rowIndexes().get(key)

      if (index !== undefined) resizeItem(index, size)
    })
    shrinks.clear()
    motion.cancel()
  }

  onCleanup(observeReducedMotion(() => prefersReducedMotion() && settleMotion()))

  // Rows rewrap at a new width. A streaming row may shrink for a moment, since the lost height is the new width's, not
  // a settling line's.
  let rewrapUntil = 0
  let widthTimer: ReturnType<typeof setTimeout> | undefined
  const heldSizes = new Map<string, number>()

  function holdWidth() {
    clearTimeout(widthTimer)
    widthTimer = setTimeout(settleWidth, 120)
  }

  function settleWidth() {
    widthTimer = undefined

    if (!rootRect || !layoutState.environment) return
    rewrapUntil = performance.now() + 400
    batch(() => setLayoutState("environment", { width: rootRect!.width, desktop: isDesktop() }))
    const held = [...shrinks, ...heldSizes]
    shrinks.clear()
    heldSizes.clear()
    held.forEach(([key, size]) => {
      const index = rowIndexes().get(key)

      if (index !== undefined) virtualizer.resizeItem(index, size)
    })
  }

  onCleanup(() => clearTimeout(widthTimer))

  function commitSize(index: number, key: string, size: number) {
    const shown = virtualizer.itemSizeCache.get(key) ?? virtualizer.measurementsCache[index]?.size

    // Streamed markdown can lose a line for a moment as it settles (a closing fence, say). While it streams, a followed
    // row keeps what it shows and gives back what it lost once the text completes.
    if (
      shown !== undefined &&
      size < shown &&
      following() &&
      streaming(rows()[index]) &&
      performance.now() > rewrapUntil
    )
      return shrinks.set(key, size)
    shrinks.delete(key)
    resizeItem(index, size)
  }

  function canAnimate() {
    return active() && layoutState.visible && !coldPending && !prefersReducedMotion()
  }

  function following() {
    return canAnimate() && input.pinned() && touchStart === undefined
  }

  // Rows that leave fade where they stand, and the rows after them close the gap as part of the same change.
  function closeRemoved(previous: string[], keys: string[]) {
    if (previous === keys) return
    const remaining = new Set(keys)
    const animate = untrack(canAnimate)
    previous.forEach((key, index) => {
      if (remaining.has(key)) return

      if (animate) fadeOutRow(key, previous[index - 1])
      knownKeys.delete(key)
      addedKeys.delete(key)
      arrivals.delete(key)
      virtualizer.itemSizeCache.delete(key)
      // VirtualRow releases its motion when it unmounts; a fading row still needs its current offset.
    })
  }

  function fadeOutRow(key: string, above: string | undefined) {
    const wrapper = virtualizer.elementsCache.get(key)?.parentElement

    if (!wrapper?.isConnected) return
    leavingCleanups.get(key)?.()
    // Exit owns opacity from this point; later motion bakes must not replay an unfinished entrance over it.
    const opacity = getComputedStyle(wrapper).opacity
    wrapper.style.opacity = opacity
    motion.leave(key)
    setLeavingKeys((keys) => (keys.includes(key) ? keys : [...keys, key]))
    wrapper.setAttribute("aria-hidden", "true")
    wrapper.inert = true
    wrapper.style.pointerEvents = "none"

    // A fading row still holds its parts, so lookups by part, like anchoring and search, must reach only the live row.
    const parts = [...wrapper.querySelectorAll<HTMLElement>("[data-timeline-part-id]")].map((element) => {
      const id = element.dataset.timelinePartId!
      element.removeAttribute("data-timeline-part-id")

      return () => element.setAttribute("data-timeline-part-id", id)
    })

    const indicator = wrapper.querySelector<HTMLElement>('[data-slot="session-working-indicator"]')

    // Working hands over to the copy button of the row it follows once that row has rendered its footer.
    if (key === "activity") handoffRow = above

    const animations =
      key === "activity"
        ? workingHandoff(indicator, undefined, prefersReducedMotion())
        : [
            wrapper.animate([{ opacity }, { opacity: 0 }], {
              duration: 110 * motionTuning.timeScale(),
              easing: "cubic-bezier(.4,0,1,1)",
              fill: "forwards",
            }),
          ]

    const cleanup = (revive = false) => {
      if (leavingCleanups.get(key) !== cleanup) return
      const target = indicator ?? wrapper
      const pose = revive ? getComputedStyle(target) : undefined

      const from: Keyframe | undefined = pose && { opacity: pose.opacity }

      if (from && pose && indicator) {
        from.filter = pose.filter
        from.transform = pose.transform
      }

      leavingCleanups.delete(key)
      animations.forEach((animation) => animation.cancel())

      if (from) {
        const to: Keyframe = { opacity: "1" }

        if (indicator) {
          const style = getComputedStyle(indicator)
          to.filter = style.filter
          to.transform = style.transform
        }

        target.animate([from, to], {
          duration: 160 * motionTuning.timeScale(),
          easing: "ease-out",
        })

        if (indicator && Number(opacity) < 1)
          wrapper.animate([{ opacity }, { opacity: 1 }], { duration: 160 * motionTuning.timeScale() })
      }

      wrapper.style.removeProperty("opacity")
      wrapper.removeAttribute("aria-hidden")
      wrapper.inert = false
      wrapper.style.removeProperty("pointer-events")
      parts.forEach((restore) => restore())
      setLeavingKeys((keys) => keys.filter((item) => item !== key))
    }

    leavingCleanups.set(key, cleanup)
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => cleanup(),
      () => cleanup(),
    )
  }

  function handOff(key: string) {
    const copy = virtualizer.elementsCache
      .get(key)
      ?.querySelector<HTMLElement>('[data-slot="text-part-copy-wrapper"] > *')

    if (copy) workingHandoff(undefined, copy, prefersReducedMotion())
  }

  const textMessage = (row: TimelineRow.TimelineRow | undefined) => {
    if (!Predicate.isTagged(row, "AssistantPart") || row.group.type !== "part") return
    const message = input.projection.messageByID().get(row.group.ref.messageID)

    if (Timeline.resolveContent(message, row.group.ref.partID)?.type === "text") return message
  }

  const streaming = (row: TimelineRow.TimelineRow | undefined) => {
    const message = textMessage(row)

    return message?.type === "assistant" && message.time.completed === undefined
  }

  createEffect(() => {
    input.projection.messageByID()
    shrinks.forEach((size, key) => {
      const index = rowIndexes().get(key)

      if (index !== undefined && streaming(rows()[index])) return
      shrinks.delete(key)

      if (index !== undefined) virtualizer.resizeItem(index, size)
    })
  })

  const pendingSizes = new Map<string, number>()
  // Read the whole measurement delivery before committing reactive row sizes.
  // Otherwise each row can render and force layout before the next is measured.
  virtualizer.resizeItem = (index, size) => {
    if (!active()) return
    const row = rows()[index]

    if (!row) return
    const key = TimelineRow.key(row)

    // Mid width change, a rewrapped row's new box waits for the width to settle.
    if (widthTimer !== undefined) {
      heldSizes.set(key, size)

      return
    }

    // TanStack does not cache a measurement equal to its estimate. Treat that estimate as committed too,
    // or a mixed pretext/DOM cold mount endlessly queues the same sizes before the browser can paint.
    const known = virtualizer.itemSizeCache.get(key) ?? virtualizer.measurementsCache[index]?.size ?? fallbackItemSize

    if (known === size) {
      pendingSizes.delete(key)
      shrinks.delete(key)

      // A modelled row's estimate reads its current model. Pin the height it shows now, or a later options change
      // can re-estimate it at a new model height before that change reaches `commit()` with a delta to anchor.
      if (!virtualizer.itemSizeCache.has(key) && modelHeight(key) !== undefined)
        virtualizer.itemSizeCache.set(key, size)

      return
    }

    pendingSizes.set(key, size)
    scheduleCommit()
  }

  onCleanup(() => pendingSizes.clear())
  // Scrolling stops following, not the visible rows' motion. Hidden timelines settle at once, since they have no
  // painted intermediate state.
  createEffect(
    on(
      [active, () => layoutState.visible],
      ([active, visible]) => {
        if (!active || !visible) settleMotion()
      },
      { defer: true },
    ),
  )

  function aboveFold(item: VirtualItem) {
    // Prepended rows can resize more than once as deferred content mounts. Keep
    // compensating while they remain entirely above the visible content fold.
    const first = virtualizer.range?.startIndex

    return addedKeys.has(String(item.key))
      ? item.end <= (virtualizer.scrollOffset ?? 0) + virtualizer.scrollAdjustments + virtualizer.options.scrollMargin
      : first !== undefined && item.index < first
  }

  function applyTouchAdjustment() {
    // Advance the logical fold before the next row decides whether it needs anchoring.
    if (!touchAdjustment) return
    setRendering("scrollAdjustment", (value) => value + touchAdjustment)
    touchAdjustment = 0
    const root = listRoot()

    if (root) reportOffset?.(root.scrollTop, virtualizer.isScrolling)
  }

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta) => {
    if (following()) return false
    const adjust = aboveFold(item)

    if (!touchScrolling || input.pinned()) return adjust

    // iOS defers native scroll writes until momentum ends. Keep the same visual
    // anchor now, rather than moving rows now and snapping the viewport back later.
    if (adjust) touchAdjustment += delta

    return false
  }

  function finishTouchScroll() {
    touchScrolling = false
    flushTouchAdjustment()
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
      setRendering("anchor", { key: TimelineRow.key(rows()[found.index]!), partID: found.partID })
    })
    // Until its ResizeObserver delivers, the opened row keeps its collapsed size, so the timeline may not scroll yet
    // (and cannot unpin) or ends above the tool. Commit the real size first.
    const opened = virtualContent?.querySelector<HTMLDivElement>(`[data-index="${found.index}"]`)

    if (opened) resizeItem(found.index, rowHeight(opened))
    const root = listRoot()

    // Unpinning reads the reported extent, so report the opened row's before asking.
    if (root) input.onScheduleScrollState(root, scrollGeometry())
    input.onUnpin()
    pinAnchor()

    return true
  }

  // Puts the anchored tool's top edge at its scroll margin, just below the headers that stick above it. Its own
  // growth extends downward, so only size changes at or above its row can move it; each of those calls this again.
  function pinAnchor() {
    const anchor = rendering.anchor
    const root = listRoot()

    if (!anchor || !root) return
    const element = virtualContent?.querySelector<HTMLElement>(`[data-timeline-part-id="${CSS.escape(anchor.partID)}"]`)

    // Following the end is a different position to hold.
    if (!element || !active() || input.pinned()) return releaseAnchor()

    // The element's box includes the drawn remainder, so it is measured from the drawn offset, not the whole one. Headers
    // stuck above it move with any remainder too, so the pin lands on a whole pixel: they stay on theirs, and the tool
    // sits within half a pixel below them. A row still springing from an earlier change is measured at its slot.
    const offset = Math.min(
      endOffset(),
      Math.max(
        0,
        Math.round(
          drawnTop +
            element.getBoundingClientRect().top -
            motion.offset(anchor.key).x -
            root.getBoundingClientRect().top -
            parseFloat(getComputedStyle(element).scrollMarginTop),
        ),
      ),
    )

    // Hand over every pin, even one the scroll already reaches: TanStack lands exactly on its last target once the
    // scroll is within a pixel of it, which would undo a compensation for a row above that resized since.
    virtualizer.scrollToOffset(offset)
  }

  function releaseAnchor() {
    if (rendering.anchor) setRendering("anchor", undefined)
  }

  function prepareNavigation(animate = false) {
    if (!animate) settleMotion()
    releaseAnchor()

    if (touchStart === undefined) touchScrolling = false
    flushTouchAdjustment()
  }

  function flushTouchAdjustment() {
    const adjustment = rendering.scrollAdjustment
    const root = listRoot()

    if (!adjustment || !root) return
    // Transfer the translation into the native offset in the same paint.
    batch(() => {
      setRendering("scrollAdjustment", 0)

      if (virtualContent) virtualContent.style.height = `${virtualizer.getTotalSize()}px`
      clearRemainder()
      // The native offset, not the cached one: an earlier flush in this task, or the drag itself, has not reported yet.
      elementScroll(Math.max(0, root.scrollTop + adjustment), {}, virtualizer)
      setLayoutState("offset", root.scrollTop)
      drawnTop = layoutState.offset
    })
  }

  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )

  const virtualRowKeys = createMemo(() => [
    ...new Set([...virtualizer.getVirtualItems().map((item) => String(item.key)), ...leavingKeys()]),
  ])

  createEffect(() => {
    if (!active() || !layoutState.visible) return
    const root = listRoot()
    const visible = visibleArea()
    untrack(() => {
      // Returning always opens the latest content at rest, including a view left scrolled into history.
      coldPending = true
      arrivals.clear()
      settleMotion()
      leavingCleanups.forEach((cleanup) => cleanup())

      if (root) input.setScrollRef(root)

      if (virtualContent) input.setContentRef(virtualContent)
      input.setVisibleRef?.(visible)
      queueMicrotask(() => {
        if (!active() || !layoutState.visible || !root?.isConnected) return
        // A detached view can miss its nonzero ResizeObserver delivery. Publish
        // its real viewport before restoring the offset and admitting rows.
        reportRect?.(rootRect ?? { width: root.offsetWidth, height: root.offsetHeight })

        // A route can open this timeline on a tool call, e.g. a shell picked from inside a subagent, instead of its end.
        const target = input.reveal?.target()

        if (target && revealPart(target)) input.reveal?.done()
        else {
          input.onPin()
          measureMountedRows()
          pinEnd()
        }

        reportOffset?.(root.scrollTop, false)
        observeColdBottom()
      })
      input.setRevealPart?.(revealPart)
      input.setRevealMessage?.((id, partID) => {
        if (!active()) return

        const partIndex = partID
          ? rows().findIndex(
              (row) =>
                Predicate.isTagged(row, "AssistantPart") &&
                row.group.type === "part" &&
                row.group.ref.partID === partID,
            )
          : -1

        const promptIndex = rows().findIndex(
          (row) => Predicate.isTagged(row, "UserMessage") && row.userMessageID === id,
        )

        const index =
          partIndex >= 0 ? partIndex : promptIndex >= 0 ? promptIndex : input.projection.messageRowIndex().get(id)

        if (index === undefined) return
        prepareNavigation()
        virtualizer.scrollToIndex(index, { align: partIndex >= 0 ? "center" : "start" })
      })
      input.setScrollToEnd?.((behavior) => {
        const root = listRoot()

        if (!active() || !root?.isConnected) return

        // Already following its end (sending a prompt resumes it): moving rows keep moving.
        if (
          behavior !== "smooth" &&
          following() &&
          !rendering.anchor &&
          !rendering.scrollAdjustment &&
          endOffset() - drawnTop <= 1
        )
          return
        const animate = (behavior === "smooth" || (behavior === undefined && motion.moving())) && canAnimate()
        prepareNavigation(animate)
        input.onPin()
        // A deep-history return only draws the final screen's move, so it mounts at most one more screen of rows.
        const from = Math.max(drawnTop, endOffset() - layoutState.viewport)
        pinEnd()

        if (animate) motion.kick(drawnTop - from, [])
      })
    })
  })

  const visibilityChanged = () => setLayoutState("visible", document.visibilityState !== "hidden")
  document.addEventListener("visibilitychange", visibilityChanged)
  onCleanup(() => document.removeEventListener("visibilitychange", visibilityChanged))

  createEffect(
    on(
      bottomInset,
      () => {
        const root = listRoot()

        if (!active() || !root?.isConnected) return
        reportRect?.(rootRect ?? { width: root.offsetWidth, height: root.offsetHeight })

        if (!input.pinned()) return
        // The composer region moved its edge: the followed end rides it in the same frame, and so does a flight
        // landing on a row. A step down, as when sending clears a long draft, is drawn from where the rows were and
        // eased on the growth spring instead.
        queueMicrotask(() => {
          const from = drawnTop
          pinEnd()
          const moved = from - drawnTop
          const eased = canAnimate() ? Math.min(Math.max(0, moved), input.bottomInsetStep?.() ?? 0) : 0
          motion.scroll(moved - eased)

          if (eased > 0) motion.kick(-eased, [])
        })
      },
      { defer: true },
    ),
  )

  let settleQueued = false
  let contentObserver: MutationObserver | undefined
  let viewportObserver: ResizeObserver | undefined

  function measureMountedRows() {
    const sizes = [...virtualizer.elementsCache.values()].flatMap((element) =>
      element.isConnected ? [[virtualizer.indexFromElement(element), rowHeight(element)] as const] : [],
    )

    batch(() => sizes.forEach(([index, height]) => virtualizer.resizeItem(index, height)))
  }

  const pinColdBottom = () => {
    if (!active()) return
    const root = listRoot()

    if (!input.pinned() || !virtualContent || !root) return
    // scrollToEnd computes its target from the DOM, not the new size cache.
    virtualContent.style.height = `${virtualizer.getTotalSize()}px`

    pinEnd()

    // Report after core size adjustments finish so they cannot apply a delta
    // twice. This avoids waiting a frame for the native scroll event.
    if (virtualizer.scrollOffset !== layoutState.offset) reportOffset?.(layoutState.offset, false)
  }

  const pendingMeasurements = () => {
    const items = virtualizer.getVirtualItems()

    return (
      (rows().length > 0 && items.length === 0) ||
      items.some((item) => {
        const element = virtualizer.elementsCache.get(item.key)

        // A synchronous attachment read can still see a tool's placeholder.
        // Reveal only after its first browser layout delivery has been committed.
        return !element?.isConnected || (modelHeight(String(item.key)) === undefined && !observedElements.has(element))
      })
    )
  }

  const settleColdBottom = () => {
    if (!active() || !coldPending || settleQueued) return
    settleQueued = true
    queueMicrotask(() => {
      settleQueued = false
      const root = listRoot()

      if (!coldPending || !virtualContent?.isConnected || !root) return

      // A provisional tail can otherwise reveal before the font-ready model fills
      // the rest of history, leaving a pinned session halfway through its final extent.
      if (!layoutState.fontsReady) return

      if (!layoutState.viewport || pendingSizes.size) return

      if (fullyModeled()) {
        // Every offset is known. Commit the extent and pin once, without waiting
        // for row observation, markdown readiness, or an estimated tail reveal.
        setRendering("initialTail", false)
        pinColdBottom()
        coldPending = false
        contentObserver?.disconnect()
        viewportObserver?.disconnect()
        virtualContent.style.removeProperty("visibility")

        return
      }

      if (virtualContent.querySelector(pendingMarkdown)) return

      // Markdown can finish before ResizeObserver delivers its new box. The
      // normal measureElement path skips reads while scrolling; this gate needs
      // current boxes before expanding the estimated range or revealing it.
      measureMountedRows()

      if (pendingSizes.size || pendingMeasurements()) return
      pinColdBottom()

      if (input.pinned() && Math.abs(endOffset() - layoutState.offset) > 1) return

      // The scroll event must update the range before newly exposed rows can reveal.
      if (endOffset() > 0 && Math.abs((virtualizer.scrollOffset ?? 0) - layoutState.offset) > 1) return

      if (rendering.initialTail) {
        setRendering("initialTail", false)
        settleColdBottom()

        return
      }

      if (pendingSizes.size || pendingMeasurements() || virtualContent.querySelector(pendingMarkdown)) return
      coldPending = false
      contentObserver?.disconnect()
      viewportObserver?.disconnect()
      virtualContent.style.removeProperty("visibility")
    })
  }

  function observeColdBottom() {
    if (!coldPending || !virtualContent) return
    contentObserver ??= new MutationObserver(settleColdBottom)
    contentObserver.observe(virtualContent, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-markdown-ready"],
    })
    viewportObserver ??= new ResizeObserver(settleColdBottom)
    const root = listRoot()

    if (root) viewportObserver.observe(root)
    settleColdBottom()
  }

  onMount(observeColdBottom)

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
    maxScroll = endOffset()

    if (active()) input.setScrollRef(root)
    viewportObserver?.observe(root)
    settleColdBottom()
    // The scrollbar thumb sits beside the viewport and stops its pointerdown from propagating, so
    // listen on the ScrollView root in the capture phase: thumb drags are user scrolls too.
    const scrollView = root.parentElement

    scrollView?.addEventListener("pointerdown", handleListPointerDown, { capture: true })
    onCleanup(() => scrollView?.removeEventListener("pointerdown", handleListPointerDown, { capture: true }))
    let revision = 0
    // Faces already loaded when the model was built; their loadingdone events change nothing.
    let knownFaces = new Set<FontFace>()

    const refresh = (event?: Event) => {
      const typography = readTimelineTypography(root, revision + 1)
      const previous = layoutState.environment?.typography

      if (previous && sameTypography(previous, typography) && !loadsNewFace(event, typography, knownFaces)) return
      const current = ++revision

      const text = [...input.projection.messageByID().values()]
        .flatMap((message) => {
          if (message.type === "user") return [message.text]

          if (message.type !== "assistant") return []

          return message.content.flatMap((content) =>
            content.type === "text" || content.type === "reasoning" ? [content.text] : [],
          )
        })
        .join("")

      // Once revealed, rows keep the current model until the new one is ready and swap in one commit.
      if (!previous) {
        setLayoutState("environment", undefined)
        setLayoutState("fontsReady", false)
      }

      void Promise.all([
        document.fonts.load(`${typography.weight} ${typography.size}px ${typography.family}`, text),
        document.fonts.load(`${typography.medium} ${typography.size}px ${typography.family}`, text),
        document.fonts.load(`${typography.weight} ${typography.size}px ${typography.codeFamily}`, text),
      ]).then(
        () => {
          if (current !== revision || !root.isConnected) return
          knownFaces = new Set([...document.fonts].filter((face) => face.status === "loaded"))
          setLayoutState("environment", {
            width: rootRect?.width ?? root.clientWidth,
            desktop: isDesktop(),
            typography,
          })
          setLayoutState("fontsReady", true)
          settleColdBottom()
        },
        () => {
          // A failed face stays on the DOM fallback until the next font/theme change.
          if (current !== revision || !root.isConnected) return
          setLayoutState("fontsReady", true)
          settleColdBottom()
        },
      )
    }

    const observer = new MutationObserver(() => refresh())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })
    document.fonts.addEventListener("loadingdone", refresh)
    refresh()
    onCleanup(() => {
      revision++
      observer.disconnect()
      document.fonts.removeEventListener("loadingdone", refresh)
    })
  }

  // Upward input is the one intent geometry cannot recover: nudging up while still a pixel from
  // the end must stop following, even though the resulting position still looks like the end.
  const handleListWheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    userScrollAt = performance.now()
    releaseAnchor()
    input.onUserScroll(event.target)

    if (event.deltaY < 0) input.onUnpin()
  }

  const handleListTouchStart = (event: TouchEvent) => {
    userScrollAt = performance.now()
    clearTouchTarget()
    releaseAnchor()
    input.onUserScroll(event.target)
    touchScrolling = true
    touchStart = event.touches[0]?.clientY
    const root = listRoot()
    const nested = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-scrollable]") : null
    touchNested = !!nested && nested !== root && nested.scrollHeight > nested.clientHeight
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

    if (current === undefined || touchStart === undefined) return
    const previous = touchStart
    touchStart = current

    // A retained target can outlive its whole session view. Only the active
    // timeline may change the shared follow state; release still cleans up below.
    if (!active()) return

    // Dragging the content downward reveals earlier messages.
    if (current <= previous) return

    // A nested scrollport owns the intent. If it chains into the timeline at a
    // boundary, the resulting native timeline scroll below will unpin instead.
    if (touchNested) return
    input.onUnpin()
  }

  const handleListTouchEnd = () => {
    clearTouchTarget()
    touchStart = undefined

    if (!virtualizer.isScrolling) finishTouchScroll()
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
  const handleListPointerDown = (event: PointerEvent) => {
    releaseAnchor()
    input.onUserScroll(event.target)
    pointerHeld = true
  }

  const releasePointer = () => {
    pointerHeld = false
  }

  onMount(() => {
    window.addEventListener("pointerup", releasePointer)
    window.addEventListener("pointercancel", releasePointer)
  })
  onCleanup(() => {
    window.removeEventListener("pointerup", releasePointer)
    window.removeEventListener("pointercancel", releasePointer)
  })

  const handleListKeyDown = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    const key = scrollKey(event)

    if (!key) return

    if (!isScrollKeyTarget(event.target, key)) return

    if (scrollKeyOwner(event.currentTarget, event.target, key) !== event.currentTarget) return
    userScrollAt = performance.now()
    releaseAnchor()
    input.onUserScroll(event.currentTarget)

    if (upwardKeys.has(key)) input.onUnpin()
  }

  // Following resumes by arriving at the end, either by scrolling there or by content shrinking
  // under a viewport that was already there. Merely resting near the end is not enough, otherwise
  // a later scroll would overwrite an upward intent expressed a pixel short of the bottom.
  const handleListScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (!active()) return
    const root = event.currentTarget
    const userDriven = pointerHeld || touchScrolling || performance.now() - userScrollAt <= 250

    // Only the echo of our own write is skipped; a clamp after the user's scroll still lands here to re-pin.
    if (
      !userDriven &&
      wholeTop !== undefined &&
      root.scrollTop === wholeTop &&
      scrollTop === wholeTop &&
      layoutState.offset === wholeTop
    ) {
      if (root.dataset.hoverStale === undefined) root.dataset.hoverStale = ""
      maxScroll = endOffset()
      settleColdBottom()
      input.onScheduleScrollState(root, scrollGeometry())

      return
    }

    const previousTop = scrollTop
    const previousMaxScroll = maxScroll
    scrollTop = root.scrollTop
    maxScroll = endOffset()
    setLayoutState("offset", scrollTop)

    // The user's own scroll carries the drawn remainder along, so content moves exactly as far as the scroll did. At
    // either end the offset is the browser's clamp, which the remainder must not outlive.
    if (
      userDriven &&
      wholeTop !== undefined &&
      scrollTop !== wholeTop &&
      scrollTop > 0 &&
      scrollTop < Math.floor(maxScroll)
    ) {
      drawnTop += scrollTop - wholeTop
      wholeTop = scrollTop
    }

    // Someone else moved the offset (the browser clamping it): the drawn remainder no longer applies.
    if (wholeTop === undefined || scrollTop !== wholeTop) {
      clearRemainder()
      drawnTop = scrollTop
    }

    // Content the timeline moves under a resting pointer must not reveal the hover-only footers it passes; the pointer
    // has to move again first. Scrolling the user drives keeps the native behavior.
    if (!pointerHeld && performance.now() - userScrollAt > 250 && root.dataset.hoverStale === undefined)
      root.dataset.hoverStale = ""
    const atEnd = maxScroll - scrollTop <= endEpsilon
    const arrived = scrollTop > previousTop + endEpsilon || maxScroll < previousMaxScroll

    // An anchor holds its tool even when reaching it lands at the end; only the user's own scroll lets it go.
    if (maxScroll <= 1 || (atEnd && arrived && !rendering.anchor)) input.onPin()
    else if ((pointerHeld || touchScrolling) && scrollTop < previousTop - endEpsilon) input.onUnpin()
    settleColdBottom()
    input.onScheduleScrollState(root, scrollGeometry())
    input.onHistoryScroll()
  }

  function View(props: ViewProps) {
    function VirtualRow(rowProps: { rowKey: string }) {
      let element: HTMLDivElement
      const initialItem = virtualItemByKey().get(rowProps.rowKey)!
      const initialRow = rowByKey().get(rowProps.rowKey)!
      const leaving = () => leavingKeys().includes(rowProps.rowKey)

      const item = createMemo<VirtualItem>(
        (previous) => virtualItemByKey().get(rowProps.rowKey) ?? previous,
        initialItem,
      )

      const row = createMemo<TimelineRow.TimelineRow>(
        (previous) => rowByKey().get(rowProps.rowKey) ?? previous,
        initialRow,
      )

      const edges = createMemo<{ top: number; bottom: number }>((previous) => {
        if (leaving() && previous) return previous
        const top = item().start - topOffset() - rendering.scrollAdjustment

        return { top: grid(top), bottom: grid(top + item().size) }
      })

      rowBoxes.set(rowProps.rowKey, edges)
      const edge = () => edgeReach[rowProps.rowKey]

      const [ready, setReady] = createSignal(initialItem.size <= fallbackItemSize || !props.deferred(initialRow))
      let contentMeasureFrame: number | undefined

      const modeled = createMemo(() => modelHeight(rowProps.rowKey) !== undefined)
      createEffect(
        on(
          () => [layoutState.fontsReady, modeled(), leaving(), item().index],
          () => {
            // Revived or reordered rows must register again even when their layout model stayed the same.
            if (leaving() || !layoutState.fontsReady) return

            // Opening a modeled compact row can expose a renderer-specific DOM fallback.
            if (!modeled()) {
              // A modeled row was cached without being observed. Dropping it lets measuring observe it, so the row follows
              // its content as it opens instead of keeping its model height.
              if (virtualizer.elementsCache.get(rowProps.rowKey) === element)
                virtualizer.elementsCache.delete(rowProps.rowKey)

              return virtualizer.measureElement(element)
            }

            virtualizer.elementsCache.set(rowProps.rowKey, element)
            observedElements.add(element)
            settleColdBottom()
          },
        ),
      )
      // Prepending history changes data-index, not the keyed element's identity.
      // Its observer reads the current index and delivers any actual size change.
      onCleanup(() => {
        rowBoxes.delete(rowProps.rowKey)

        if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
        queueMicrotask(() => virtualizer.measureElement(null))
        motion.drop(rowProps.rowKey)
      })

      return (
        <div
          data-timeline-key={rowProps.rowKey}
          aria-hidden={Predicate.isTagged(initialRow, "TurnGap") || leaving() ? "true" : undefined}
          style={{
            position: "absolute",
            top: `${edges().top}px`,
            left: "calc((100% - var(--panel-hold-width, 100%)) / 2)",
            width: "var(--panel-hold-width, 100%)",
            height: `${edges().bottom - edges().top + (edge() ?? 0)}px`,
            // A delivered user's label can still be collapsing after its modeled slot has shrunk. Only its reveal
            // owns a clip; otherwise the bubble and footer must remain visible as the surrounding rows close up.
            overflow: Predicate.isTagged(row(), "UserMessage") && !edge() ? "visible" : "clip",
            "overflow-clip-margin": Predicate.isTagged(row(), "TurnGap") ? undefined : "0.5px",
            // The soft edge a revealing row's content passes under; the box's motion moves it, not style writes.
            "mask-image": edge()
              ? `linear-gradient(to bottom, #000 calc(100% - ${edge()}px), rgba(0, 0, 0, 0.72) calc(100% - ${grid(edge()! * 0.62)}px), rgba(0, 0, 0, 0.28) calc(100% - ${grid(edge()! * 0.28)}px), transparent)`
              : undefined,
          }}
        >
          <div
            ref={(value) => {
              element = value

              if (modeled()) virtualizer.elementsCache.set(rowProps.rowKey, value)
              const mounted = row()

              if (Predicate.isTagged(mounted, "UserMessage"))
                queueMicrotask(() => {
                  const bubble = value.querySelector<HTMLElement>('[data-slot="user-message-text"]')

                  if (bubble)
                    landSendFlight(mounted.userMessageID, bubble, (carrier) => motion.follow(rowProps.rowKey, carrier))
                })

              if (
                !Predicate.isTagged(row(), "UserMessage") ||
                !addedKeys.has(rowProps.rowKey) ||
                modeled() ||
                !input.pinned() ||
                coldPending ||
                following()
              )
                return
              // The optimistic row can paint before ResizeObserver corrects the tail estimates.
              // Measure the mounted tail and pin it in this render's microtask instead.
              queueMicrotask(() => {
                if (!input.pinned() || !virtualContent?.isConnected) return
                virtualizer.elementsCache.forEach((item) => {
                  if (item.isConnected) virtualizer.resizeItem(virtualizer.indexFromElement(item), rowHeight(item))
                })
                virtualizer.resizeItem(item().index, rowHeight(element))
                virtualContent.style.height = `${virtualizer.getTotalSize()}px`
                pinEnd()
              })
            }}
            data-index={leaving() ? -1 : item().index}
            style={{ "min-height": ready() || modeled() ? undefined : `${initialItem.size}px` }}
          >
            {props.renderRow(row, () => {
              setReady(true)

              if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)

              if (modeled()) return
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
      <div
        ref={setViewRoot}
        class="relative w-full h-full min-w-0"
        style={{
          "--session-timeline-inset": `${bottomInset()}px`,
        }}
      >
        <div
          class="absolute bottom-[calc(var(--session-timeline-inset)+32px)] left-1/2 -translate-x-1/2 z-[60] pointer-events-none transition-[opacity,translate]"
          classList={{
            "opacity-100 translate-y-0 duration-150 ease-[cubic-bezier(.2,.8,.2,1)]":
              input.scroll().overflow && input.scroll().jump,
            "opacity-0 translate-y-1 motion-reduce:translate-y-0 duration-[110ms] ease-[cubic-bezier(.4,0,1,1)]":
              !input.scroll().overflow || !input.scroll().jump,
          }}
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
          verticalGeometry={scrollGeometry()}
          onWheel={handleListWheel}
          onTouchStart={handleListTouchStart}
          onPointerMove={() => delete listRoot()?.dataset.hoverStale}
          onKeyDown={handleListKeyDown}
          onScroll={handleListScroll}
          onClick={input.onSelectionInteraction}
          class="relative min-w-0 w-full h-full"
          style={{ "--sticky-accordion-top": input.showHeader() ? "var(--session-header-height, 48px)" : "0px" }}
        >
          <Show when={input.showHeader()} fallback={<div aria-hidden="true" class="h-4 md:hidden" />}>
            {props.header}
          </Show>
          <div
            data-timeline-virtual-content
            ref={(element) => {
              virtualContent = element

              if (active()) input.setContentRef(element)
            }}
            style={{
              height: `${contentHeight()}px`,
              position: "relative",
              width: "100%",
              // Rows held wider than the timeline mid-flight don't scroll it sideways.
              "overflow-x": "clip",
              visibility: coldBottomMount ? "hidden" : undefined,
            }}
          >
            <div ref={rowLayer} class="absolute inset-0">
              <For each={virtualRowKeys()}>{(rowKey) => <VirtualRow rowKey={rowKey} />}</For>
            </div>
            <div
              data-timeline-row="bottom-spacer"
              class="absolute top-0 left-0 w-full"
              style={{
                height: `${tailSize}px`,
                transform: `translateY(${virtualizer.getTotalSize() - tailSize - rendering.scrollAdjustment}px)`,
              }}
            >
              {props.bottomSpacer}
            </div>
          </div>
          <div aria-hidden="true" data-timeline-inset class="h-[var(--session-timeline-inset)] shrink-0" />
        </ScrollView>
        <div
          ref={setVisibleArea}
          data-slot="session-timeline-visible"
          class="pointer-events-none absolute inset-x-0 top-0 bottom-[var(--session-timeline-inset)]"
        />
      </div>
    )
  }

  onCleanup(() => {
    settleMotion()
    cache.delete(ownerSessionKey)
    cache.set(ownerSessionKey, {
      measurements: virtualizer.takeSnapshot(),
      toolOpen: { ...toolOpen },
      patchGroupKeys,
      presentationKey: input.presentationKey?.(),
    })

    while (cache.size > 16) cache.delete(cache.keys().next().value!)
    coldPending = false
    contentObserver?.disconnect()
    viewportObserver?.disconnect()

    if (active()) {
      input.setScrollRef(undefined)
      input.setRevealMessage?.(() => {})
      input.setRevealPart?.(() => false)
      input.setScrollToEnd?.(() => {})
    }
  })

  return {
    disclosure: {
      patchGroupKeys,
      value: (key: string) => toolOpen[key],
      set: (key: string, open: boolean) => {
        // Direct disclosure should respond at control speed, independently of streamed row growth.
        capture()
        disclosing = true
        setToolOpen(key, open)
        // Measure this user action now instead of waiting for the next ResizeObserver delivery.
        measureMountedRows()
      },
    },
    revealPart,
    View,
  }
}

function sameTypography(a: TimelineTypography, b: TimelineTypography) {
  // SAFETY: a typography model is a plain record of exactly its declared keys.
  return (Object.keys(a) as (keyof TimelineTypography)[]).every((key) => key === "revision" || a[key] === b[key])
}

// A face of the timeline's families that loaded after the model was built can change its text metrics.
function loadsNewFace(event: Event | undefined, typography: TimelineTypography, known: Set<FontFace>) {
  if (!(event instanceof FontFaceSetLoadEvent)) return false

  const families = new Set(
    [typography.family, typography.codeFamily].flatMap((list) => list.split(",").map(familyName)),
  )

  return event.fontfaces.some((face) => !known.has(face) && families.has(familyName(face.family)))
}

function familyName(value: string) {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase()
}

function sameLayout(previous: TimelineRowLayout | undefined, next: TimelineRowLayout | undefined) {
  if (!previous || !next || previous.source !== next.source) return previous === next

  if (previous.source === "dom")
    return next.source === "dom" && previous.reason === next.reason && previous.blocks === next.blocks

  return next.source !== "dom" && previous.height === next.height
}
