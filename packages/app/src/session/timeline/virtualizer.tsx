import {
  createVirtualizer,
  defaultRangeExtractor,
  elementScroll,
  observeElementRect,
  type Range,
  type VirtualItem,
} from "@tanstack/solid-virtual"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner, ScrollView } from "@opencode/ui/scroll-view"
import { ownScroll } from "@opencode/ui/hold-scroll"
import { Predicate } from "effect"
import { Timeline, TimelineRow } from "@opencode/session-ui/timeline/projection"
import { useLanguage } from "@/runtime/i18n/language"
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Key } from "@solid-primitives/keyed"
import { createMediaQuery } from "@solid-primitives/media"
import type { createTimelineProjection } from "./projection"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"
import {
  keepPlace,
  letterAt,
  letterIndex,
  PLACE_NEIGHBOURS,
  placeOf,
  resolvePlace,
  takePlace,
  type Place,
} from "./place"
import {
  createPlaceReturnState,
  PLACE_LEFT_EVENT,
  PLACE_RENDERED_EVENT,
  PLACE_RETURN_TIMEOUT,
  PLACE_TAKEN_EVENT,
  returningPlace,
  transitionPlaceReturn,
  type PlaceReturnEffect,
  type PlaceReturnEvent,
} from "./place-machine"
import { RECONNECT_OFFSET_EPSILON } from "./reconnect-machine"
import { filterVirtualIndexes, isAboveFold } from "./virtual-items"
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
import { frameLoop, prefersReducedMotion, Spring } from "@opencode/ui/motion"
import { holdLandingWidth } from "@/shell/panel-motion"
import type { TimelineFollow } from "./follow"
import {
  CONTACT_LOST_EVENT,
  defersAdjustments,
  END_EPSILON,
  GLIDE_END_EVENT,
  GLIDE_START_EVENT,
  isGliding,
  isRoaming,
  isTouchHeld,
  MIN_OVERFLOW,
  needsEndProbe,
  ZOOM_SLACK,
} from "./machine"

const fallbackItemSize = 60

// The glide to the latest message: a spring without bounce, close to the browser's own smooth scroll over one screen.
const glideSpring = { duration: 0.5, bounce: 0 }

const pendingMarkdown = '[data-component="markdown"]:not([data-markdown-ready])'

// Content a row still waits for: a deferred body, a file view, Markdown or a diagram that has not rendered.
const pendingContent = `[data-disclosure-pending], [data-component="file"]:not([data-file-ready]), [data-mermaid-pending], ${pendingMarkdown}`

// The attributes those markers change with.
const pendingAttributes = ["data-disclosure-pending", "data-file-ready", "data-mermaid-pending", "data-markdown-ready"]

const upwardKeys = new Set(["up", "page-up", "home"])

const settledEvent = { type: "scroll.settled", atReachableEnd: false } as const

const settledAtEndEvent = { type: "scroll.settled", atReachableEnd: true } as const

const touchStartEvent = { type: "touch.start", nested: false } as const

const nestedTouchStartEvent = { type: "touch.start", nested: true } as const

const touchEndEvent = { type: "touch.end", scrolling: false } as const

const touchMomentumEvent = { type: "touch.end", scrolling: true } as const

const pointerDownEvent = { type: "pointer.down" } as const

const pointerUpEvent = { type: "pointer.up" } as const

/** A row on screen: its key, the row it draws and where TanStack places it. */
type MountedRow = { key: string; row: TimelineRow.TimelineRow; item: VirtualItem }

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
  focusComposer?: () => void
  setScrollRef: (element: HTMLDivElement | undefined) => void
  /** The rows' content changed height. */
  onContentResize: () => void
  /** Height of the composer region floating over the timeline's bottom edge, where the timeline fades out. */
  bottomInset?: Accessor<number>
  /** Room the status line needs past the 36px lane, so it keeps its gap to the activity pill. */
  tailExtra?: Accessor<number>
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
  headerInset?: JSX.Element
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
  const tailSize = () => (touch() ? 104 : 92) + (input.tailExtra?.() ?? 0)
  const ownerSessionKey = input.sessionKey()
  const entry = cache.get(ownerSessionKey)
  const cached = entry?.presentationKey === input.presentationKey?.() ? entry : undefined
  const initialMeasurements = cached?.measurements
  // The session whose reader's place this view keeps as it goes away, and comes back to.
  const placeSession = input.follow.session()
  // Where that reader was when the session's view last went away with them off its end. This view starts near it.
  const arrival = placeOf(placeSession)

  // The follow state belongs to the session on screen. A view that is not shown keeps what its own reader last had.
  const follows = createMemo<boolean>(
    (previous) => (active() ? input.follow.following() : previous),
    input.follow.following(),
  )

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
  // Rows measured with no content still to come: the reader may have seen them at their real height.
  const settled = new Set<string>()
  // Rows the reader pressed in, until they are next resized with no content still to come.
  const acted = new Set<string>()

  const getItemKey = createMemo(() => {
    const keys = rowKeys()
    const arrived = new Set(keys.filter((key) => !knownKeys.has(key)))
    arrived.forEach((key) => {
      knownKeys.add(key)
      addedKeys.add(key)
    })

    // The space above a reply row depends on the reply row before it. Rows that arrive above a row the list already
    // had change the height of the first reply row under them, so the rows down to that one no longer have the
    // height the reader saw.
    if (arrived.size > 0)
      keys.forEach((key, index) => {
        if (arrived.has(key) || !arrived.has(keys[index - 1] ?? "")) return
        const under = untrack(rows).slice(index, index + 3)
        const reply = under.findIndex((row) => Predicate.isTagged(row, "AssistantPart"))

        under.slice(0, reply < 0 ? 1 : reply + 1).forEach((row) => settled.delete(TimelineRow.key(row)))
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
  // The frame each row's element was first observed in. A row first observed in the frame being rendered has not
  // been shown yet.
  const shownFrom = new WeakMap<Element, number>()
  // Rows that keep the room the list gave them while their content is still to come.
  const holding = new WeakSet<Element>()
  // The finger's last position, a measurement only: whether it is down is the follow machine's `isTouchHeld`.
  let lastTouchY = 0
  let touchTarget: EventTarget | null = null
  // Size compensation deferred during one resize delivery, committed or dropped before the delivery ends.
  let touchAdjustment = 0
  // The first and last of the rows in the scroll port that hold still while the size batch being applied resizes
  // the others: the rows the reader has seen at their real height that it leaves as they are. -1 for none. Unset
  // outside a batch, while the view is where a jump or the end put it, and at the start of the list.
  let still: { first: number; last: number } | undefined
  // The width each row was last measured at. Text wraps again at a new width.
  const widths = new WeakMap<Element, number>()
  // The row measured last changed width, a measurement only: the resize that follows it reads it once.
  let wrapped = false
  // Whether the change that the size batch is applying to a row is above what the reader is on. Unset when that is
  // not known, or does not lead the row.
  let aboveLine: boolean | undefined
  // Where the first row would be on the screen with the list at its start, as last reported. Unset while hidden.
  let origin: number | undefined

  // What the reader is on: the content the reading line met when the view last came to rest. A letter, or the element
  // there when no letter is near. `lead`: how far below that content's top the line was. `at`: how far below its
  // row's top. `y`: where on the screen. Unset while the reader scrolls.
  let reading: { key: string; node: Node; offset: number | undefined; lead: number; at: number; y: number } | undefined

  // The look at what the reader is on that waits for the next frame to render. `fresh`: it starts over at the reading
  // line. Otherwise it follows what was taken to its new place. `again`: it may wait one more frame for a row.
  let pendingLook: { fresh: boolean; again: boolean; cancel: () => void } | undefined
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
  // The offset and range the timeline last read, and how far the reader has moved the offset since the last scroll
  // event. `lost`: the view left the document, which drops its offset, so the next read starts over. Measurements
  // only: whether the reader left the end is the follow machine's to decide.
  const seen = { top: 0, max: 0, reader: 0, lost: false }

  // Reused for every scroll: the transition only reads it, so a scroll allocates nothing.
  const scrollEvent = {
    type: "scroll" as const,
    scrollTop: 0,
    previousTop: 0,
    maxScroll: 0,
    previousMaxScroll: 0,
    reader: 0,
  }

  const intentEvent = { type: "scroll.intent" as const, upward: false, overflow: false }
  const touchDragEvent = { type: "touch.drag" as const, overflow: false }
  let reportOffset: ((offset: number, scrolling: boolean) => void) | undefined
  // The space above the first row when the view's offset was last reported.
  let reportedMargin = 0
  let reportRect: ((rect: { width: number; height: number }) => void) | undefined
  // TanStack corrects the scroll position once for every row it resizes above the view, and each native write forces a
  // layout. While a batch of sizes is applied, a request replaces the one before it, and the last is written once.
  let scrollHeld = false
  let heldScroll: (() => void) | undefined
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

        // A taller viewport shortens the scroll range. Read the clamp before anything else grows the range again.
        if (root) readScroll(root)
        batch(() => {
          // The container-responsive header can be 48px or 80px.
          setHeaderHeight(
            root ? parseFloat(getComputedStyle(root).getPropertyValue("--session-header-height")) || 48 : 48,
          )
          callback({ width: rect.width, height: Math.max(0, rect.height - bottomInset()) })
        })

        if (root) keepOrigin(root, rect.height > 0)
      }

      return observeElementRect(instance, (rect) => {
        if (active()) reportRect?.(rect)
      })
    },
    // Route navigation detaches and reattaches the scroll element, which drops its offset.
    observeElementOffset: (instance, callback) => {
      reportOffset = (offset, scrolling) => {
        if (!active()) return
        reportedMargin = instance.options.scrollMargin
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

      // A scroll that has come to rest leaves the reader on something. The other reports of the offset come from the
      // timeline's own writes, some of them while the rows hold a layout their boxes do not have yet.
      const settle = (offset: number, scrolling: boolean) => {
        reportOffset?.(offset, scrolling)

        if (!scrolling) lookAfterRender(true)
      }

      return observeElementOffsetReconnectAware(instance, settle, (returning) => {
        if (!active()) return
        const root = listRoot()

        // The reattached element lost its offset, which is not the reader scrolling to the top.
        if (root) syncScroll(root)
        virtualContent?.querySelectorAll<HTMLDivElement>("[data-index]").forEach(virtualizer.measureElement)

        if (input.follow.following()) virtualizer.scrollToEnd()

        if (returning) restoreOffset()
        dispatchCold(CHECK_REQUESTED)
      })
    },
    // Near where the reader was, so that the first rows to mount are the ones they come back to.
    initialOffset: () => {
      if (input.follow.following()) return Number.MAX_SAFE_INTEGER

      if (!arrival) return 0
      const keys = untrack(rowKeys)
      const target = resolvePlace(arrival, keys)

      if (target.type === "end") return Number.MAX_SAFE_INTEGER
      const start = initialMeasurements?.find((item) => item.key === keys[target.row])?.start

      return (start ?? target.row * fallbackItemSize) + target.offset
    },
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

      if (entry && !shownFrom.has(element)) shownFrom.set(element, frame())
      const box = entry?.borderBoxSize[0]

      if (box) {
        wrapped = (widths.get(element) ?? box.inlineSize) !== box.inlineSize
        widths.set(element, box.inlineSize)

        return Math.round(box.blockSize)
      }

      if (initial) {
        const size = instance.itemSizeCache.get(instance.options.getItemKey(instance.indexFromElement(element)))

        if (size !== undefined || untrack(coldHidden)) return size ?? fallbackItemSize
      }

      return element.offsetHeight
    },
    scrollToFn: (offset, options, instance) => {
      if (!active()) return

      if (coldMountFlushing(untrack(coldMount)) && input.follow.following()) return
      const root = instance.scrollElement
      // A glide to the end arrives there itself. A jump to the end before then would cut it short, and history that
      // loads above the view must not show, so such a write only puts the view where the glide has brought it. The
      // corrections for rows that change size go through.
      const gliding = options.adjustments === undefined && isGliding(input.follow.peek())
      touchAdjustment = 0
      setRendering("scrollAdjustment", 0)

      const write = () => {
        // A held write runs when its batch ends. What moved the view until then was not this write.
        if (root) readScroll(root)

        if (virtualContent) virtualContent.style.height = `${instance.getTotalSize()}px`

        if (gliding && root) {
          // The range as the new height leaves it.
          readScroll(root)
          placeGlide(root, 0)

          return
        }

        elementScroll(offset, options, instance)

        if (root) syncScroll(root)
      }

      if (!scrollHeld) return write()
      heldScroll = write
    },
    get getItemKey() {
      return getItemKey()
    },
    get anchorTo() {
      return follows() ? "end" : "start"
    },
    get followOnAppend() {
      return follows()
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
  const pendingSizes = new Map<number, { key: string; size: number; wrapped: boolean }>()
  let resizeScheduled = false

  const flushHeldScroll = () => {
    const write = heldScroll
    heldScroll = undefined
    write?.()
  }

  // Read the whole measurement delivery before committing reactive row sizes.
  // Otherwise each row can render and force layout before the next is measured.
  virtualizer.resizeItem = (index, size) => {
    const rewrapped = wrapped
    wrapped = false

    if (!active()) return
    const row = rows()[index]

    if (!row) return
    const key = TimelineRow.key(row)

    const known = virtualizer.itemSizeCache.get(key) ?? fallbackItemSize

    if (known === size) {
      pendingSizes.delete(index)
      settle(key)

      return
    }

    const element = virtualizer.elementsCache.get(key)

    // A placeholder is not the row's height. While its content is still to come, a row keeps the room the list has
    // given it: shrinking to the placeholder moved the rows around it once, and the content moved them again. Only
    // under a reader who rests where they scrolled. A view that follows the end shows a new row at the height it
    // has: with the 60px the list gives a new row, the reply above it went up by that room and came back down.
    if (size < known && isRoaming(input.follow.peek()) && element?.querySelector(pendingContent)) {
      pendingSizes.delete(index)
      holding.add(element)

      return
    }

    pendingSizes.set(index, { key, size, wrapped: rewrapped || pendingSizes.get(index)?.wrapped === true })

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

      const root = listRoot()

      // Rows that left the list shorten the scroll range. Read the clamp before these sizes grow the range again.
      if (root && input.follow.following()) readScroll(root)

      // The rows can report their sizes before the viewport reports its own. What the reader is on is looked for
      // where the rows were before the layout moved the list's start.
      if (root) keepOrigin(root, root.clientHeight > 0)
      // The hidden pinned mount needs one bottom write after the whole batch,
      // not a layout-forcing scroll adjustment for every measured row.
      dispatchCold(SIZES_FLUSHING)
      // At the start of the list the start is what stays, as the end does for a reader who follows it.
      const offset = virtualizer.scrollOffset ?? 0
      const top = offset + virtualizer.options.scrollPaddingStart
      const range = isRoaming(input.follow.peek()) && offset > 0 ? virtualizer.range : null
      const resizing = new Set(sizes.map(([index]) => index))

      const held = range
        ? Array.from(
            { length: range.endIndex - range.startIndex + 1 },
            (_, offset) => range.startIndex + offset,
          ).filter((index) => {
            const item = virtualizer.measurementsCache[index]

            return !!item && !resizing.has(index) && item.end > top && familiar(String(item.key))
          })
        : undefined

      still = held && { first: held[0] ?? -1, last: held.at(-1) ?? -1 }
      // A layout can change a row anywhere in it: code keeps its lines where the prose under it wraps again, and
      // content that arrives late arrives at one place. So what the reader is on says where they are: the rows
      // before its row change above them, the rows after it below them, and its own row by as much as it moved
      // them. It leads every row while the view rests where the reader scrolled it, and a row that wrapped again in
      // any view. Not at the start of the list, where the start stays.
      const words = offset > 0 && (held || sizes.some(([, value]) => value.wrapped)) ? readingPlace() : undefined

      // TanStack folds each correction into the offset it believes, and stops that offset at the start of the list.
      // Near the start, rows that got shorter before others got taller ran it into that stop, and the rows in view
      // ended too high by what the stop took. Rows that grow go first.
      const grows = ([index, value]: (typeof sizes)[number]) =>
        value.size > (virtualizer.itemSizeCache.get(value.key) ?? virtualizer.measurementsCache[index]?.size ?? 0)

      const ordered = [...sizes.filter(grows), ...sizes.filter((entry) => !grows(entry))]

      batch(() => {
        scrollHeld = true

        try {
          ordered.forEach(([index, value]) => {
            const row = rows()[index]

            if (!row || TimelineRow.key(row) !== value.key) return
            const item = virtualizer.measurementsCache[index]
            // A row the reader pressed in keeps its own top edge.
            const led = words && item && (held || value.wrapped) && !acted.has(value.key) ? words : undefined

            // TanStack compensates a resize in full or not at all, so the row the reader is on resizes in two steps:
            // first by what its change moved them, then by the rest.
            const steps =
              led && index === led.index ? [Math.max(0, Math.round(item.size + led.moved)), value.size] : [value.size]

            steps.forEach((size, step) => {
              aboveLine = !led ? undefined : index === led.index ? step === 0 : index < led.index
              resizeItem(index, size)

              // TanStack recalculates its range after each resize. Advance the
              // logical fold before deciding whether the next row needs anchoring.
              if (!touchAdjustment) return
              const delta = touchAdjustment
              touchAdjustment = 0

              // A delta deferred under momentum that has since ended is dropped rather than translating the rows.
              if (!defersAdjustments(input.follow.peek())) return
              setRendering("scrollAdjustment", (value) => value + delta)

              if (!root) return
              // The native offset is read next, so it has to include any correction still held.
              flushHeldScroll()
              reportOffset?.(root.scrollTop, virtualizer.isScrolling)
            })
          })
        } finally {
          scrollHeld = false
          // Inside the batch, so what reacts to the new sizes reads the corrected offset, as it did with one write a row.
          flushHeldScroll()
        }
      })
      aboveLine = undefined
      still = undefined
      keepReading(words?.now)
      sizes.forEach(([, value]) => {
        settle(value.key)

        if (!virtualizer.elementsCache.get(value.key)?.querySelector(pendingContent)) acted.delete(value.key)
      })
      dispatchCold(SIZES_FLUSHED)
      pinAnchor()
      dispatchPlace(PLACE_RENDERED_EVENT)

      if (untrack(coldHidden)) pinColdBottom()
      dispatchCold(CHECK_REQUESTED)

      if (untrack(coldHidden) || !input.follow.following() || isGliding(input.follow.peek())) return

      // Reopening a settled scroll-to-end operation can fight subsequent keyboard scrolling.
      if (root && !atReachableEnd(root)) virtualizer.scrollToEnd()
    })
  }

  onCleanup(() => pendingSizes.clear())

  // A row settles once it is measured with no content still to come.
  function settle(key: string) {
    if (settled.has(key)) return
    const element = virtualizer.elementsCache.get(key)

    if (element?.isConnected && !element.querySelector(pendingContent)) settled.add(key)
  }

  // The frame being rendered, or the last one rendered.
  function frame() {
    return Number(document.timeline.currentTime ?? 0)
  }

  // The reader has seen the row at its real height: it has settled, and it was shown before this frame.
  function familiar(key: string) {
    const element = virtualizer.elementsCache.get(key)
    const from = element && shownFrom.get(element)

    return settled.has(key) && from !== undefined && from !== frame()
  }

  // A layout that moves the list's start on the screen moves every row with it: below 768px a bar opens above the
  // timeline and the space above the first row gets shorter. For a reader who rests where they scrolled, the rows
  // keep their place on the screen. A view at the end, at the start or where navigation put it keeps its place in
  // the scroll port.
  function keepOrigin(root: HTMLDivElement, shown: boolean) {
    const next =
      shown && virtualContent?.isConnected ? virtualContent.getBoundingClientRect().top + root.scrollTop : undefined

    const shift = next === undefined || origin === undefined ? 0 : next - origin

    // A zoomed layout places the list a fraction of a pixel off from one layout to the next.
    if (next !== undefined && origin !== undefined && Math.abs(shift) < 1) return
    const moved = Math.round(shift)
    origin = next

    if (!moved || !isRoaming(input.follow.peek()) || root.scrollTop <= 0) return
    readScroll(root)
    elementScroll(root.scrollTop + moved, {}, virtualizer)
    syncScroll(root)
    reportOffset?.(root.scrollTop, virtualizer.isScrolling)
  }

  // The box of a text position's character, or of an element.
  function readingBox(node: Node, offset: number | undefined) {
    if (offset === undefined) return node instanceof Element ? node.getBoundingClientRect() : undefined

    if (!(node instanceof Text) || node.length === 0) return
    const range = document.createRange()
    const start = Math.min(offset, node.length - 1)
    range.setStart(node, start)
    range.setEnd(node, start + 1)

    return range.getBoundingClientRect()
  }

  // The content of a row at a point of the screen: the letter nearest to it, or else the element there. Beside a
  // short line and between two blocks, the nearest letter is a little above or below the point. An element is held
  // by its top: a share of its height would be a guess at where it grew.
  function contentAt(x: number, y: number) {
    const hit = document.elementsFromPoint(x, y).find((element) => element !== rowLayer && rowLayer?.contains(element))
    const row = hit?.closest<HTMLElement>("[data-index]")
    const key = row?.parentElement?.dataset.timelineKey

    if (!hit || !row || !key) return
    const at = y - row.getBoundingClientRect().top
    const caret = document.caretPositionFromPoint?.(x, y)
    const text = caret && caret.offsetNode instanceof Text && row.contains(caret.offsetNode) ? caret : undefined
    const letter = text && readingBox(text.offsetNode, text.offset)

    if (text && letter && letter.height > 0 && letter.top - 32 <= y && letter.bottom + 32 >= y)
      return { key, node: text.offsetNode, offset: text.offset, lead: y - letter.top, at, y }

    return { key, node: hit, offset: undefined, lead: y - hit.getBoundingClientRect().top, at, y }
  }

  // Whether the list has applied the height a row has now. A row that changed after it was last measured has its
  // content somewhere the reader has not seen it: the page has not painted that layout yet.
  function applied(key: string) {
    const row = virtualizer.elementsCache.get(key)

    return (
      !!row &&
      Math.abs(row.getBoundingClientRect().height - (virtualizer.itemSizeCache.get(key) ?? fallbackItemSize)) < 1
    )
  }

  // The content at the reading line now: a letter at the middle of the line, or a quarter of the way in from either
  // side, before an element. It reads the layout and keeps nothing.
  function atReadingLine() {
    const root = listRoot()

    if (!root?.isConnected || !rowLayer || !active()) return
    const offset = virtualizer.scrollOffset ?? 0
    const y = root.getBoundingClientRect().top + readingLine(offset) - offset
    const band = rowLayer.getBoundingClientRect()
    const at = (share: number) => contentAt(band.left + band.width * share, y)
    const middle = at(1 / 2)

    // One look finds a letter in prose. The sides are looked at only when the middle has none.
    return middle?.offset !== undefined
      ? middle
      : ([at(1 / 4), at(3 / 4)].find((side) => side?.offset !== undefined) ?? middle)
  }

  // Takes what the reader is on, from a row whose height the list has applied.
  function takeReading(again = true) {
    reading = undefined
    const content = atReadingLine()

    if (!content) return

    if (applied(content.key)) {
      reading = content

      return
    }

    // The row at the line waits for the list to apply its new height. Look once more after the next frame.
    if (again) lookAfterRender(true, false)
  }

  // Looks for what the reader is on once the next frame has rendered. That frame's layout is done then, so the look
  // forces none. In the task of a rest or of a size batch it would: a scroll write or a resize has just made the
  // layout dirty.
  function lookAfterRender(fresh: boolean, again = true) {
    if (pendingLook) {
      pendingLook.fresh ||= fresh

      return
    }

    const look = { fresh, again, cancel: () => cancelAnimationFrame(frame) }

    const frame = requestAnimationFrame(() => {
      const timer = setTimeout(() => {
        pendingLook = undefined

        // The reader scrolled on: the rest after that scroll looks again. A view that follows returns to its end,
        // whatever its rows do, so it needs none.
        if (virtualizer.isScrolling || input.follow.following()) return

        if (look.fresh || !followReading()) takeReading(look.again)
      })

      look.cancel = () => clearTimeout(timer)
    })

    pendingLook = look
  }

  // The row of what the reader is on, how far below the row's top it is now, and how far the layout moved it there.
  // Only while the row's box, which has not been resized yet, still has it where it was taken.
  function readingPlace() {
    const target = reading
    const row = target && virtualizer.elementsCache.get(target.key)

    if (!target || !row?.isConnected || !target.node.isConnected || !row.contains(target.node)) return
    const box = readingBox(target.node, target.offset)
    const top = row.getBoundingClientRect().top

    if (!box?.height || Math.abs(top + target.at - target.y) > 2) return
    const now = box.top + target.lead - top

    return { index: virtualizer.indexFromElement(row), moved: now - target.at, now }
  }

  // After a batch, what the reader is on has a new place in its row. Where it is on the screen is read once the rows
  // have their new boxes.
  function keepReading(now: number | undefined) {
    if (!reading || now === undefined) return
    reading = { ...reading, at: now }
    lookAfterRender(false)
  }

  // Reads where what the reader is on is now. False when there is nothing left to follow.
  function followReading() {
    const target = reading
    const row = target && virtualizer.elementsCache.get(target.key)

    const box =
      target && row?.isConnected && row.contains(target.node) ? readingBox(target.node, target.offset) : undefined

    if (!target || !row || !box?.height) return false

    // The row changed again after the batch. The batch that applies that change reads how far it moved them.
    if (!applied(target.key)) return true
    const y = box.top + target.lead
    reading = { ...target, at: y - row.getBoundingClientRect().top, y }

    return true
  }

  // What the reader sees is the scroll port, from the session header's fade to the composer region. The reading line
  // is 40% of the way down it.
  function readingLine(offset: number) {
    const top = offset + virtualizer.options.scrollPaddingStart

    return top + (offset + (virtualizer.scrollRect?.height ?? 0) - top) * 0.4
  }

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
    const offset = (instance.scrollOffset ?? 0) + instance.scrollAdjustments
    const key = String(item.key)
    const below = !!still && still.last > item.index
    const above = !!still && still.first >= 0 && still.first < item.index

    // What stays where it is depends on what is known.
    // What the reader is on, taken when their scroll came to rest: a change above it is compensated, a change below
    // it is not. The size batch has decided that.
    // Otherwise, in a view that is where the end or navigation put it, at the start of the list, for a row the
    // reader pressed in and for a row they have seen at its real height: the row's own top edge, so it is
    // compensated only while the reader cannot see it. Prepended rows can resize more than once as deferred
    // content mounts.
    // Otherwise the row has not been seen at its real height, in a view the reader is still scrolling or has just
    // scrolled: the rows in the scroll port that hold still. With those on one side of it, they stay. With them on
    // both sides or on neither, the reading line stays: a row that starts above it grows upward, any other downward.
    const adjust =
      aboveLine ??
      (!still || acted.has(key) || familiar(key)
        ? addedKeys.has(key)
          ? item.end <= offset + instance.options.scrollMargin
          : isAboveFold(item, instance.range?.startIndex, offset + instance.options.scrollPaddingStart)
        : below !== above
          ? below
          : item.start < readingLine(offset))

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
    dispatchPlace(PLACE_TAKEN_EVENT)
    flushTouchAdjustment()
  }

  // A view that is not shown leaves the document, and its element comes back at offset 0. The virtualizer still holds
  // the offset the element had: where the reader was, which TanStack moves with the row there when rows arrive above
  // it. Writing that offset back keeps the reader's place. A view that follows goes to its end instead.
  function restoreOffset() {
    const root = listRoot()
    const offset = virtualizer.scrollOffset

    if (!root || offset === null || input.follow.following()) return

    if (Math.abs(root.scrollTop - offset) <= RECONNECT_OFFSET_EPSILON) return
    virtualizer.options.scrollToFn(offset, {}, virtualizer)
  }

  // A reader's return to where they were. The machine decides; this only runs what it asks for. Its state is set
  // before any effect runs, so the result of a look finds the return it belongs to.
  let placeReturn = createPlaceReturnState()
  let placeFrame: number | undefined
  let placeTimer: ReturnType<typeof setTimeout> | undefined

  function dispatchPlace(event: PlaceReturnEvent) {
    const next = transitionPlaceReturn(placeReturn, event)
    placeReturn = next.state
    next.effects.forEach(runPlaceEffect)
  }

  function runPlaceEffect(effect: PlaceReturnEffect) {
    if (effect.type === "look")
      return dispatchPlace({ type: "looked", attempt: effect.attempt, end: putBack(effect.place) })

    if (effect.type === "timer.start") {
      clearTimeout(placeTimer)
      placeTimer = setTimeout(() => dispatchPlace({ type: "timeout", attempt: effect.attempt }), PLACE_RETURN_TIMEOUT)

      return
    }

    if (placeFrame !== undefined) cancelAnimationFrame(placeFrame)
    placeFrame = undefined

    if (effect.type === "cancel") return clearTimeout(placeTimer)
    placeFrame = requestAnimationFrame(() => {
      placeFrame = undefined
      dispatchPlace(PLACE_RENDERED_EVENT)
    })
  }

  // Keeps where the reader is as the view goes away. A return that had not ended keeps the place it was going to. A
  // reader who follows the end keeps none: they come back to the end.
  function depart() {
    keepPlace(placeSession, returningPlace(placeReturn) ?? here())
    dispatchPlace(PLACE_LEFT_EVENT)
  }

  // Where a reader who has left the end is: the row at the top of the view and how far into it the view begins, with
  // the rows around it. Read from what the list holds, because a view that goes away is out of the page by then.
  function here(): Place | undefined {
    const offset = virtualizer.scrollOffset

    if (untrack(follows) || offset === null) return
    // The list's rows begin after the space above the first row. A window that crosses a breakpoint changes that
    // space before the view leaves the page, and the offset still counts from the old one.
    const top = offset + virtualizer.options.scrollMargin - reportedMargin
    const item = virtualizer.getVirtualItemForOffset(top)

    if (!item) return
    const keys = untrack(rowKeys)
    // What the reader is on, taken when their scroll came to rest. A text node does not outlive its view, so the
    // letter is kept by how many letters of its row come before it.
    const on = reading
    const row = on && virtualizer.elementsCache.get(on.key)

    const index =
      on && row && on.node instanceof Text && on.offset !== undefined ? letterIndex(row, on.node, on.offset) : undefined

    return {
      key: String(item.key),
      offset: top - item.start,
      after: keys.slice(item.index + 1, item.index + 1 + PLACE_NEIGHBOURS),
      before: keys.slice(Math.max(0, item.index - PLACE_NEIGHBOURS), item.index).toReversed(),
      letter: on && index !== undefined ? { key: on.key, index, top: on.y - on.lead } : undefined,
    }
  }

  // A place on the screen, moved into the part of the view the reader sees: below the session header, above the
  // composer region.
  function onScreen(root: HTMLDivElement, top: number, height: number) {
    const port = root.getBoundingClientRect().top
    const end = port + (virtualizer.scrollRect?.height ?? root.clientHeight) - height

    return Math.max(port + virtualizer.options.scrollPaddingStart, Math.min(end, top))
  }

  // Puts a returning reader back where they were, as far as the rows have rendered. True when the passage is gone
  // from the session and the view went to the end instead.
  function putBack(place: Place) {
    const root = listRoot()

    if (!root?.isConnected || !active()) return false
    const keys = rowKeys()
    const target = resolvePlace(place, keys)

    if (target.type === "end") {
      // What is left of the session ends before the place. Its reader follows the end, as one who never left it.
      input.follow.dispatch({ type: "follow" })
      virtualizer.scrollToEnd()

      return true
    }

    const item = virtualizer.measurementsCache[target.row]
    const row = virtualizer.elementsCache.get(keys[target.row]!)
    const port = root.getBoundingClientRect().top
    const letter = target.letter
    const line = letter && virtualizer.elementsCache.get(keys[letter.row]!)
    const at = letter && line?.isConnected ? letterAt(line, letter.index) : undefined
    const box = at && readingBox(at.node, at.offset)
    const lineItem = letter && virtualizer.measurementsCache[letter.row]

    // As drawn. What the reader was on goes back where it was on the screen, or as near as the part of the view
    // they see now allows: that holds at any width. A reader who was on no text, and one whose text has not
    // rendered yet, gets the row at the top of the view as far above the top as it was. A row that is not in the
    // page has only its place in the list, an estimate until the rows before it have their sizes. The view goes
    // there, so that the row mounts.
    const wanted =
      letter && box?.height
        ? root.scrollTop + box.top - onScreen(root, letter.top, box.height)
        : letter && lineItem && !line?.isConnected
          ? lineItem.start - (letter.top - port)
          : row?.isConnected
            ? root.scrollTop + row.getBoundingClientRect().top - port + target.offset
            : item && item.start + target.offset

    if (wanted === undefined || Math.abs(root.scrollTop - Math.max(0, wanted)) <= 0.5) return false
    // One of the timeline's own writes. The list is told at once, so that the rows there mount in this frame.
    virtualizer.options.scrollToFn(Math.max(0, wanted), {}, virtualizer)
    reportOffset?.(root.scrollTop, false)

    return false
  }

  function flushTouchAdjustment() {
    touchAdjustment = 0
    const adjustment = rendering.scrollAdjustment
    const root = listRoot()

    if (!adjustment || !root) return
    readScroll(root)
    // Transfer the translation into the native offset in the same paint.
    batch(() => {
      setRendering("scrollAdjustment", 0)

      if (virtualContent) virtualContent.style.height = `${virtualizer.getTotalSize()}px`
      elementScroll(Math.max(0, root.scrollTop + adjustment), {}, virtualizer)
    })
    syncScroll(root)
  }

  // How far the glide to the latest message still has to go.
  const glideGap = Spring.fromDuration(0, glideSpring)
  let cancelGlide: (() => void) | undefined

  // Glides to the end as the timeline's own animation. The browser's smooth scroll heads for where the end was when
  // it started, and starts again from rest each time it gets a new target, so a reply that streams left it far
  // behind and the next row measurement jumped the rest of the way. TanStack's smooth scroll to the end aims at the
  // last row by its index, which an older page that loads meanwhile gives to a row in the middle of the history.
  // This spring closes the distance to the end wherever the end moves, and each step is one of the timeline's own
  // scroll writes.
  function glide(root: HTMLDivElement) {
    cancelGlide?.()
    readScroll(root)
    // Glide only the final screen. Crossing the whole history smoothly would stream every row through the virtualizer.
    root.scrollTo({ top: Math.max(seen.top, seen.max - root.clientHeight) })
    syncScroll(root)
    glideGap.snap(seen.max - seen.top).set(0)
    input.follow.dispatch(GLIDE_START_EVENT)
    cancelGlide = frameLoop.addMeasured(
      () => {
        if (active() && root.isConnected) readScroll(root)
      },
      (dt) => {
        // The reader or a navigation took over, or this view went away.
        if (!active() || !isGliding(input.follow.peek())) return false

        if (root.isConnected && placeGlide(root, dt) >= 1) return true
        input.follow.dispatch(GLIDE_END_EVENT)
        // TanStack lands on the exact end once the rows there have measured.
        virtualizer.scrollToEnd()

        return false
      },
    )
  }

  // Puts the view as far from the end as the glide still has to go, `dt` seconds on, and returns that distance.
  // Content that arrives below carries the view along and history that loads above leaves it where it is, so neither
  // adds to the distance. Whatever brought the view closer to the end, such as the reader's own scroll toward it,
  // shortens the glide. The caller has just read the scroll.
  function placeGlide(root: HTMLDivElement, dt: number) {
    glideGap.value = Math.min(glideGap.value, seen.max - seen.top)
    const left = glideGap.step(dt)
    root.scrollTo({ top: left < 1 ? seen.max : seen.max - left })
    syncScroll(root)

    return left
  }

  onCleanup(() => cancelGlide?.())

  // A row mounts with the row and the place it draws, so it never has to find either. TanStack lists the rows it last
  // read, which one flush can replace before it reads them again; a listed key the projection dropped is not a row.
  // One row mounts per key: a turn interrupted twice has two dividers under one key, and one measurement.
  const mountedRows = createMemo(() => [
    ...new Map(
      virtualizer.getVirtualItems().flatMap((item): [string, MountedRow][] => {
        const key = String(item.key)
        const row = rowByKey().get(key)

        return row ? [[key, { key, row, item }]] : []
      }),
    ).values(),
  ])

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
      // A reader who had left the end comes back to where they were. The place is handed over once. A tool call the
      // route opens the session on takes its place.
      const place = takePlace(placeSession)
      dispatchPlace({ type: "returned", place: revealed ? undefined : place })

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
      dispatchPlace(PLACE_TAKEN_EVENT)
      input.follow.dispatch({ type: "follow" })

      if (behavior === "smooth") return glide(root)
      virtualizer.scrollToEnd({ behavior })
    })
    input.setPage?.((direction) => {
      const root = listRoot()

      if (!active() || !root?.isConnected) return
      prepareNavigation()
      input.onUserScroll(root)
      dispatchIntent(direction < 0)
      readScroll(root)
      const from = seen.top
      // Like the timeline's own PageUp: 80% of a page, measured above the composer that covers its bottom. The scroll
      // event then pins at the end or loads older history near the top, as a wheel scroll does.
      virtualizer.scrollToOffset(root.scrollTop + direction * (visibleArea()?.clientHeight || root.clientHeight) * 0.8)
      // The page is the reader's scroll, as the same key in the transcript is: it leaves the end, and arrives at it.
      seen.reader += seen.top - from
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

  // Reads where the view is and counts its movement since the last read as the reader's. Every scroll write the
  // timeline makes sits between a `readScroll` and a `syncScroll`, so its own movement never counts, even when the
  // browser folds it into the same scroll event as the reader's.
  function readScroll(root: HTMLDivElement) {
    // A view comes back to the document at offset 0. That is not the reader scrolling to the top.
    if (seen.lost || !root.isConnected) {
      seen.reader = 0

      return syncScroll(root)
    }

    const max = root.scrollHeight - root.clientHeight
    // Rubber-banding runs the offset past the range and back, which moves nothing in it.
    const top = Math.min(Math.max(0, root.scrollTop), max)
    // A scroll range that shrinks takes a view at its end up with it: the browser's clamp, not the reader.
    const clamped = top < seen.top && max < seen.max && max - top <= ZOOM_SLACK

    if (!clamped) seen.reader += top - seen.top
    seen.top = top
    seen.max = max
  }

  /** Takes the offset and range as they are now, after a write of the timeline's own or a reset by the browser. */
  function syncScroll(root: HTMLDivElement) {
    seen.lost = !root.isConnected
    seen.max = root.scrollHeight - root.clientHeight
    seen.top = Math.min(Math.max(0, root.scrollTop), seen.max)
  }

  // Within the zoom slack only a write finds the end the browser reaches: one that does not move proves the view is
  // already there, and one that does is undone before anything paints.
  function atReachableEnd(root: HTMLDivElement) {
    readScroll(root)
    const top = root.scrollTop
    const distance = root.scrollHeight - root.clientHeight - top

    if (distance <= END_EPSILON) return true

    if (distance > ZOOM_SLACK) return false
    root.scrollTop = root.scrollHeight

    if (root.scrollTop === top) return true
    root.scrollTop = top
    syncScroll(root)

    return false
  }

  // Returns whether the view now rests at its end with that offset reported.
  const pinColdBottom = () => {
    if (!active()) return false
    const root = listRoot()

    if (!input.follow.following() || !virtualContent || !root) return false
    readScroll(root)
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
        // A view that is not shown leaves the document, and comes back without its offset.
        seen.lost = true
        origin = undefined

        if (value) return
        depart()
        // A view that goes inactive mid-touch never sees its finger lift; its translation would outlive the gesture.
        clearTouchTarget()
        flushTouchAdjustment()
        setRendering("scrollAdjustment", 0)

        if (input.sessionKey() !== ownerSessionKey) return
        input.follow.dispatch(CONTACT_LOST_EVENT)
        // A glide stops with its view. The view pins to the end when it is shown again.
        input.follow.dispatch(GLIDE_END_EVENT)
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

  let disownScroll: (() => void) | undefined

  onCleanup(() => disownScroll?.())

  const bindListRoot = (root: HTMLDivElement) => {
    if (root === listRoot()) return
    // TanStack owns anchoring; browser scroll anchoring would fight its adjustments.
    root.style.overflowAnchor = "none"
    setListRoot(root)
    scrollTop = root.scrollTop
    maxScroll = root.scrollHeight - root.clientHeight
    syncScroll(root)
    disownScroll?.()
    // A component in a row that scrolls to hold a control in place writes through here (`holdScroll`), which makes
    // the write one of the timeline's own.
    disownScroll = ownScroll(root, (write) => {
      readScroll(root)
      write()
      syncScroll(root)
    })

    if (active()) input.setScrollRef(root)
    viewportObserver?.observe(root)
    dispatchCold(CHECK_REQUESTED)
    // Capture on the ScrollView root, so a press that something inside stops from propagating still counts. The
    // scrollbar thumb is portalled out of it: a thumb drag shows as the reader's movement in `handleListScroll`.
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
    // The reader moves the view themselves. That wins over a place the view has not reached yet.
    dispatchPlace(PLACE_TAKEN_EVENT)

    if (!input.follow.following()) stopScroll()
  }

  // Ends TanStack's scroll to a target, which it writes again whenever a measurement moves the target, so that the
  // reader's input wins over it. Callers leave a scroll to the end running while the timeline still follows the end.
  // TanStack has no call for this. Its declaration names the field, so a rename fails the type check rather than
  // leaving the scroll running.
  function stopScroll() {
    virtualizer["scrollState"] = null
  }

  // Heard on the whole view: a wheel over the session header or the jump button, which lie over the timeline, scrolls
  // it too, and its event never reaches the scroll element.
  const handleViewWheel = (event: WheelEvent) => {
    // A wheel with no vertical distance moves nothing in the timeline: a sideways one, over a code block for example.
    // It is not the reader scrolling, so it ends no seek and says nothing about where the reader is headed.
    if (!active() || !event.deltaY) return
    input.onUserScroll(event.target)
    dispatchIntent(event.deltaY < 0)
  }

  const handleListTouchStart = (event: TouchEvent) => {
    clearTouchTarget()

    const touch = event.touches[0]

    if (!active() || !touch) return
    input.onUserScroll(event.target)
    dispatchPlace(PLACE_TAKEN_EVENT)
    lastTouchY = touch.clientY
    const root = listRoot()
    const nested = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-scrollable]") : null

    input.follow.dispatch(
      nested && nested !== root && nested.scrollHeight > nested.clientHeight ? nestedTouchStartEvent : touchStartEvent,
    )

    if (!input.follow.following()) stopScroll()
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

    if (!input.follow.following()) stopScroll()
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
    dispatchPlace(PLACE_TAKEN_EVENT)
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

  // A press or a key that changes the layout, such as the review panel's toggle, comes before the layout changes.
  // When the look after the rest has not happened yet, or found a row that still waited, what the reader is on is
  // taken here. Not in a view that follows: it returns to its end.
  const readBeforeInput = (event: Event) => {
    if (reading || !active() || input.follow.following()) return

    if (event instanceof KeyboardEvent) {
      const key = scrollKey(event)

      // A key that scrolls: the scroll drops what was taken, and the rest after it takes it again.
      if ((key && isScrollKeyTarget(event.target, key)) || event.key === "Home" || event.key === "End") return
      const target = event.target instanceof HTMLElement ? event.target : undefined

      // A key that types changes no layout around the timeline.
      if (
        target &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return
    }

    takeReading()
  }

  onMount(() => {
    window.addEventListener("pointerup", releasePointer)
    window.addEventListener("pointercancel", releasePointer)
    window.addEventListener("blur", loseContact)
    document.addEventListener("visibilitychange", loseHiddenContact)
    window.addEventListener("pointerdown", readBeforeInput, { capture: true })
    window.addEventListener("keydown", readBeforeInput, { capture: true })
  })
  onCleanup(() => {
    window.removeEventListener("pointerup", releasePointer)
    window.removeEventListener("pointercancel", releasePointer)
    window.removeEventListener("blur", loseContact)
    document.removeEventListener("visibilitychange", loseHiddenContact)
    window.removeEventListener("pointerdown", readBeforeInput, { capture: true })
    window.removeEventListener("keydown", readBeforeInput, { capture: true })

    pendingLook?.cancel()
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
    readScroll(root)
    scrollEvent.previousTop = scrollTop
    scrollEvent.previousMaxScroll = maxScroll
    scrollTop = root.scrollTop
    maxScroll = root.scrollHeight - root.clientHeight
    scrollEvent.scrollTop = scrollTop
    scrollEvent.maxScroll = maxScroll
    scrollEvent.reader = seen.reader

    // The reader moved on from what they were on.
    if (seen.reader) reading = undefined
    seen.reader = 0
    const following = input.follow.following()
    input.follow.dispatch(scrollEvent)

    // A scroll of the reader's own that leaves the end also ends the timeline's scroll to it.
    if (following && !input.follow.following()) stopScroll()
    dispatchCold(CHECK_REQUESTED)
    input.onScheduleScrollState(root)
    input.onHistoryScroll()
  }

  function View(props: ViewProps) {
    // `mounted` only ever holds this row's own key, up to the update that unmounts it.
    function VirtualRow(rowProps: { mounted: Accessor<MountedRow> }) {
      let element: HTMLDivElement
      const initial = rowProps.mounted()
      const item = createMemo(() => rowProps.mounted().item)
      const row = createMemo(() => rowProps.mounted().row)
      const [ready, setReady] = createSignal(initial.item.size <= fallbackItemSize || !props.deferred(initial.row))
      let contentMeasureFrame: number | undefined

      onMount(() => virtualizer.measureElement(element))
      // Prepending history changes data-index, not the keyed element's identity.
      // Its observer reads the current index and delivers any actual size change.
      onCleanup(() => {
        acted.delete(initial.key)

        if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)

        // A row that leaves the mounted range takes its focused control with it, and Chromium then leaves focus on
        // <body>. The focus rescue would move it to a control in another row, and focusing that scrolls the timeline
        // to it. The viewport takes focus instead, without scrolling, so the scroll keys keep working.
        if (element.contains(document.activeElement)) listRoot()?.focus({ preventScroll: true })
        queueMicrotask(() => virtualizer.measureElement(null))
      })

      return (
        <div
          data-timeline-key={initial.key}
          style={{
            position: "absolute",
            top: `${item().start - topOffset() - rendering.scrollAdjustment}px`,
            left: "0",
            width: "100%",
            height: `${item().size}px`,
            overflow: "clip",
            // Room for paint rounding, card shadows and a focus ring (2px at a 2px offset) on a control at the row edge.
            "overflow-clip-margin": Predicate.isTagged(row(), "TurnGap") ? undefined : "5px",
          }}
        >
          <div
            ref={(value) => {
              element = value

              if (
                !Predicate.isTagged(row(), "UserMessage") ||
                !addedKeys.has(initial.key) ||
                !input.follow.following() ||
                coldHidden()
              )
                return
              // The optimistic row can paint before ResizeObserver corrects the tail estimates.
              // Measure the mounted tail and pin it in this render's microtask instead.
              queueMicrotask(() => {
                if (!input.follow.following() || !virtualContent?.isConnected) return
                const root = listRoot()

                // A row that left the list shortens the scroll range. Read the clamp before these sizes grow it again.
                if (root) readScroll(root)
                virtualizer.elementsCache.forEach((item) => {
                  if (item.isConnected) virtualizer.resizeItem(virtualizer.indexFromElement(item), item.offsetHeight)
                })
                virtualizer.resizeItem(item().index, element.offsetHeight)
                virtualContent.style.height = `${virtualizer.getTotalSize()}px`
                virtualizer.scrollToEnd()
                // A height a row has only now, between two layouts of this frame, never reaches the ResizeObserver:
                // it reports a size only when it differs from the last one it saw. Read the rows again once the
                // frame has rendered, or the row keeps the height and everything below it sits that much too low.
                requestAnimationFrame(() => {
                  if (!active() || !virtualContent?.isConnected) return
                  virtualizer.elementsCache.forEach((item) => {
                    if (item.isConnected) virtualizer.measureElement(item)
                  })
                })
              })
            }}
            data-index={item().index}
            style={{ "min-height": ready() ? undefined : `${initial.item.size}px` }}
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

    // Content can arrive without changing its row's height, and then no measurement follows. Read the row again when
    // a marker in it changes, so the row settles and gives up the room it held for a placeholder.
    onMount(() => {
      if (!virtualContent) return
      const changed = new Set<HTMLDivElement>()
      let measureFrame: number | undefined

      const observer = new MutationObserver((records) => {
        records.forEach((record) => {
          const row = record.target instanceof Element ? record.target.closest<HTMLDivElement>("[data-index]") : null
          const key = row?.parentElement?.dataset.timelineKey

          if (row && key && (holding.has(row) || !settled.has(key))) changed.add(row)
        })

        if (!changed.size || measureFrame !== undefined) return
        measureFrame = requestAnimationFrame(() => {
          measureFrame = undefined
          const rows = [...changed]
          changed.clear()

          if (!active()) return
          rows.forEach((row) => {
            holding.delete(row)

            if (row.isConnected) virtualizer.measureElement(row)
          })
        })
      })

      observer.observe(virtualContent, { subtree: true, attributes: true, attributeFilter: pendingAttributes })
      onCleanup(() => {
        observer.disconnect()

        if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
      })
    })

    return (
      <div
        ref={setViewRoot}
        class="relative w-full h-full min-w-0"
        // Passive, as on the scroll element: the compositor never waits on the main thread to scroll.
        on:wheel={{ passive: true, handleEvent: handleViewWheel }}
      >
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
            class="pointer-events-auto flex items-center justify-center w-8 h-7 px-2 py-1.5 rounded-lg border-none cursor-pointer text-v2-text-text-base backdrop-blur-[2px] hover:bg-[linear-gradient(var(--v2-overlay-simple-overlay-hover),var(--v2-overlay-simple-overlay-hover))] active:bg-[linear-gradient(var(--v2-overlay-simple-overlay-pressed),var(--v2-overlay-simple-overlay-pressed))]"
            style={{
              "background-color": "color-mix(in srgb, var(--v2-background-bg-base) 92%, transparent)",
              "box-shadow": "var(--v2-elevation-raised), 0px 2px 8px var(--v2-background-bg-base)",
            }}
            onClick={(event) => {
              input.onResumeScroll(prefersReducedMotion() ? "auto" : "smooth")

              // From the keyboard, the button hides under its own focus; the prompt is where the session continues.
              if (event.detail === 0) input.focusComposer?.()
            }}
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
        <Show when={input.showHeader()}>
          {/* The scroll viewport's fade masks anything outside the chat, including the review toggle when open. */}
          <div class="pointer-events-none absolute inset-x-0 top-0 z-30">{props.header}</div>
        </Show>
        <ScrollView
          data-slot="session-timeline-scroll"
          data-focus-scope
          viewportRef={bindListRoot}
          thumbContainer={visibleArea()}
          thumbHoverTarget={viewRoot()}
          onBeforeScroll={prepareNavigation}
          verticalScrollAdjustment={rendering.scrollAdjustment}
          onTouchStart={handleListTouchStart}
          onKeyDown={handleListKeyDown}
          onScroll={handleListScroll}
          onClick={(event) => {
            // Following would scroll a selection away.
            if (window.getSelection()?.toString()) input.follow.dispatch({ type: "detach" })
            // The reader acts on a row they are looking at, so what it opens grows downward from where it is.
            const key = event.target.closest<HTMLElement>("[data-timeline-key]")?.dataset.timelineKey

            if (key) acted.add(key)
          }}
          class="relative min-w-0 w-full h-full"
          style={{ "--sticky-accordion-top": input.showHeader() ? "var(--session-header-height, 48px)" : "0px" }}
        >
          <Show when={input.showHeader()} fallback={<div aria-hidden="true" class="h-4 md:hidden" />}>
            {props.headerInset}
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
              <Key each={mountedRows()} by={(mounted) => mounted.key}>
                {(mounted) => <VirtualRow mounted={mounted} />}
              </Key>
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
      depart()
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
