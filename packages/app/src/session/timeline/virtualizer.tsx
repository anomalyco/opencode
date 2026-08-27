import {
  createVirtualizer,
  defaultRangeExtractor,
  elementScroll,
  type Range,
  type VirtualItem,
} from "@tanstack/solid-virtual"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner, ScrollView } from "@opencode-ai/ui/scroll-view"
import { TimelineRow } from "@opencode-ai/session-ui/timeline/projection"
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
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import type { createTimelineProjection } from "./projection"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"
import { filterVirtualIndexes } from "./virtual-items"

const fallbackItemSize = 60
const pendingMarkdown = '[data-component="markdown"]:not([data-markdown-ready])'
// Distance from the bottom that counts as "at the end". Deliberately tight: a collapse clamps
// exactly to the end, while a one-pixel nudge upward is a deliberate move away from it.
const endEpsilon = 0.5
const upwardKeys = new Set(["up", "page-up", "home"])
const cache = new Map<string, { measurements: VirtualItem[]; toolOpen: Record<string, boolean | undefined> }>()

type Projection = Pick<
  ReturnType<typeof createTimelineProjection>,
  "activeMessageID" | "messageLastRowIndex" | "messageRowIndex" | "rowByKey" | "rows"
>

type Input = {
  sessionKey: Accessor<string>
  projection: Projection
  showHeader: Accessor<boolean>
  /** True while the timeline follows the newest content. Drives every anchoring decision. */
  pinned: Accessor<boolean>
  scroll: Accessor<{ overflow: boolean; jump: boolean }>
  onResumeScroll: () => void
  setScrollRef: (element: HTMLDivElement | undefined) => void
  setContentRef: (element: HTMLDivElement) => void
  onScheduleScrollState: (element: HTMLDivElement) => void
  onPin: () => void
  onUnpin: () => void
  onSelectionInteraction: (event: MouseEvent) => void
  onUserScroll: (target?: EventTarget | null) => void
  onHistoryScroll: () => void
  setRevealMessage?: (fn: (id: string) => void) => void
  setScrollToEnd?: (fn: () => void) => void
}

type ViewProps = {
  header: JSX.Element
  bottomSpacer?: JSX.Element
  workspaceSession: Accessor<boolean>
  deferred: (row: TimelineRow.TimelineRow) => boolean
  renderRow: (row: Accessor<TimelineRow.TimelineRow>, onSizeChange?: () => void) => JSX.Element
}

export function createTimelineVirtualizer(input: Input) {
  const language = useLanguage()
  const ownerSessionKey = input.sessionKey()
  const cached = cache.get(ownerSessionKey)
  const initialMeasurements = cached?.measurements
  const coldBottomMount = !initialMeasurements?.length && input.pinned()
  const [listRoot, setListRoot] = createSignal<HTMLDivElement>()
  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>(cached?.toolOpen ?? {})
  const [overscan, setOverscan] = createSignal(2)
  const rows = input.projection.rows
  const rowByKey = input.projection.rowByKey
  const knownKeys = new Set(rows().map(TimelineRow.key))
  const addedKeys = new Set<string>()
  const measuredElements = new WeakSet<Element>()
  let touchStart: number | undefined
  let pointerHeld = false
  let maxScroll = 0
  let virtualContent: HTMLDivElement | undefined
  let scrollTop = 0

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return rows().length
    },
    getScrollElement: () => listRoot() ?? null,
    // Route navigation detaches and reattaches the scroll element, which drops its offset.
    observeElementOffset: (instance, callback) =>
      observeElementOffsetReconnectAware(instance, callback, () => {
        if (input.pinned()) virtualizer.scrollToEnd()
      }),
    initialOffset: () => (input.pinned() ? Number.MAX_SAFE_INTEGER : 0),
    initialMeasurementsCache: initialMeasurements,
    estimateSize: () => fallbackItemSize,
    // A newly observed element gets a real ResizeObserver box before paint. Reuse
    // its snapshot on attachment, but later explicit measurements must read layout
    // so deferred/rewrapped content cannot keep stale, clipped heights (TanStack/virtual#1183).
    measureElement: (element, entry, instance) => {
      const initial = !measuredElements.has(element)
      measuredElements.add(element)
      const box = entry?.borderBoxSize[0]
      if (box) return Math.round(box.blockSize)
      if (initial) {
        const size = instance.itemSizeCache.get(instance.options.getItemKey(instance.indexFromElement(element)))
        if (size !== undefined) return size
      }
      return element.offsetHeight
    },
    scrollToFn: (offset, options, instance) => {
      if (virtualContent) virtualContent.style.height = `${instance.getTotalSize()}px`
      elementScroll(offset, options, instance)
    },
    get getItemKey() {
      const items = rows()
      items
        .map(TimelineRow.key)
        .filter((key) => !knownKeys.has(key))
        .forEach((key) => {
          knownKeys.add(key)
          addedKeys.add(key)
        })
      return (index: number) => {
        const row = items[index]
        if (!row) return `removed:${index}`
        return TimelineRow.key(row)
      }
    },
    get anchorTo() {
      return input.pinned() ? "end" : "start"
    },
    get followOnAppend() {
      return input.pinned()
    },
    scrollEndThreshold: 80,
    get scrollMargin() {
      return input.showHeader() ? 64 : 0
    },
    paddingEnd: 64,
    get rangeExtractor() {
      const id = input.projection.activeMessageID()
      const active = id ? (input.projection.messageLastRowIndex().get(id) ?? -1) : -1
      const buffer = overscan()
      return (range: Range) => {
        const indexes = defaultRangeExtractor({ ...range, overscan: buffer })
        return filterVirtualIndexes(
          [...new Set([...indexes, ...(active < 0 ? [] : [active])])].sort((a, b) => a - b),
          range.count,
        )
      }
    },
  })
  const resizeItem = virtualizer.resizeItem
  const pendingSizes = new Map<number, { key: string; size: number }>()
  let resizeScheduled = false
  // Read the whole measurement delivery before committing reactive row sizes.
  // Otherwise each row can render and force layout before the next is measured.
  virtualizer.resizeItem = (index, size) => {
    const row = rows()[index]
    if (!row) return
    const key = TimelineRow.key(row)
    if (virtualizer.itemSizeCache.get(key) === size) {
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
      batch(() => {
        sizes.forEach(([index, value]) => {
          const row = rows()[index]
          if (row && TimelineRow.key(row) === value.key) resizeItem(index, value.size)
        })
      })
      if (!input.pinned()) return
      const root = listRoot()
      // Reopening a settled scroll-to-end operation can fight subsequent keyboard scrolling.
      if (root && Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop) > endEpsilon)
        virtualizer.scrollToEnd()
    })
  }
  onCleanup(() => pendingSizes.clear())
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    // Prepended rows can resize more than once as deferred content mounts. Keep
    // compensating while they remain entirely above the visible content fold.
    if (addedKeys.has(String(item.key)))
      return item.end <= (instance.scrollOffset ?? 0) + instance.scrollAdjustments + instance.options.scrollMargin
    const first = instance.range?.startIndex
    return first !== undefined && item.index < first
  }
  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )
  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => String(item.key)))

  createEffect(() => {
    input.setRevealMessage?.((id) => {
      const index = input.projection.messageRowIndex().get(id)
      if (index === undefined) return
      virtualizer.scrollToIndex(index, { align: "center" })
    })
    input.setScrollToEnd?.(() => {
      input.onPin()
      virtualizer.scrollToEnd()
    })
  })

  let settleFrame: number | undefined
  let overscanFrame: number | undefined
  let overscanTimer: number | undefined
  const expandOverscan = () => {
    overscanFrame = requestAnimationFrame(() => {
      overscanFrame = undefined
      // Let the visible rows paint before building the normal interaction buffer.
      overscanTimer = window.setTimeout(() => {
        overscanTimer = undefined
        setOverscan(20)
      }, 0)
    })
  }
  const pendingMeasurements = () =>
    virtualizer.getVirtualItems().some((item) => !virtualizer.itemSizeCache.has(item.key))
  const settleColdBottom = () => {
    if (input.pinned()) virtualizer.scrollToEnd()
    if (virtualContent?.querySelector(pendingMarkdown) || pendingMeasurements()) {
      settleFrame = requestAnimationFrame(settleColdBottom)
      return
    }
    settleFrame = requestAnimationFrame(() => {
      if (input.pinned()) virtualizer.scrollToEnd()
      if (virtualContent?.querySelector(pendingMarkdown) || pendingMeasurements()) {
        settleColdBottom()
        return
      }
      settleFrame = undefined
      virtualContent?.style.removeProperty("visibility")
      expandOverscan()
    })
  }
  onMount(() => {
    if (coldBottomMount) settleFrame = requestAnimationFrame(settleColdBottom)
    if (!coldBottomMount) expandOverscan()
  })

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
    setListRoot(root)
    // TanStack owns anchoring; browser scroll anchoring would fight its adjustments.
    root.style.overflowAnchor = "none"
    scrollTop = root.scrollTop
    maxScroll = root.scrollHeight - root.clientHeight
    input.setScrollRef(root)
  }

  // Upward input is the one intent geometry cannot recover: nudging up while still a pixel from
  // the end must stop following, even though the resulting position still looks like the end.
  const handleListWheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    input.onUserScroll(event.target)
    if (event.deltaY < 0) input.onUnpin()
    setOverscan(20)
  }

  const handleListTouchStart = (event: TouchEvent) => {
    input.onUserScroll(event.target)
    touchStart = event.touches[0]?.clientY
    setOverscan(20)
  }

  const handleListTouchMove = (event: TouchEvent & { currentTarget: HTMLDivElement }) => {
    const current = event.touches[0]?.clientY
    if (current === undefined || touchStart === undefined) return
    // Dragging the content downward reveals earlier messages.
    if (current <= touchStart) return
    touchStart = current
    input.onUnpin()
  }

  // Drag-selecting past the edge and dragging the scrollbar both scroll without a wheel or key,
  // so a held pointer is what separates those from the virtualizer's own measurement adjustments.
  const handleListPointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    input.onUserScroll(event.target)
    pointerHeld = true
    setOverscan(20)
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
    input.onUserScroll(event.currentTarget)
    if (upwardKeys.has(key)) input.onUnpin()
    setOverscan(20)
  }

  // Following resumes by arriving at the end, either by scrolling there or by content shrinking
  // under a viewport that was already there. Merely resting near the end is not enough, otherwise
  // a later scroll would overwrite an upward intent expressed a pixel short of the bottom.
  const handleListScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const root = event.currentTarget
    const previousTop = scrollTop
    const previousMaxScroll = maxScroll
    scrollTop = root.scrollTop
    maxScroll = root.scrollHeight - root.clientHeight
    const atEnd = maxScroll - scrollTop <= endEpsilon
    const arrived = scrollTop > previousTop + endEpsilon || maxScroll < previousMaxScroll
    if (maxScroll <= 1 || (atEnd && arrived)) input.onPin()
    else if (pointerHeld && scrollTop < previousTop - endEpsilon) input.onUnpin()
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
        queueMicrotask(() => virtualizer.measureElement(null))
      })

      return (
        <div
          data-timeline-key={rowProps.rowKey}
          style={{
            position: "absolute",
            top: `${item().start - (input.showHeader() ? 64 : 0)}px`,
            left: "0",
            width: "100%",
            height: `${item().size}px`,
            overflow: "clip",
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
            {props.renderRow(row, () => {
              setReady(true)
              if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
              contentMeasureFrame = requestAnimationFrame(() => {
                contentMeasureFrame = undefined
                if (element.isConnected) virtualizer.measureElement(element)
              })
            })}
          </div>
        </div>
      )
    }

    return (
      <div class="relative w-full h-full min-w-0" data-workspace-session={props.workspaceSession() ? "" : undefined}>
        <div
          class="absolute left-1/2 -translate-x-1/2 z-[60] pointer-events-none transition-all duration-200 ease-out"
          classList={{
            "bottom-8": true,
            "opacity-100 translate-y-0 scale-100": input.scroll().overflow && input.scroll().jump,
            "opacity-0 translate-y-2 pointer-events-none": !input.scroll().overflow || !input.scroll().jump,
            "scale-[0.8]": !input.scroll().overflow || !input.scroll().jump,
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
            onClick={input.onResumeScroll}
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
          onPointerDown={handleListPointerDown}
          onKeyDown={handleListKeyDown}
          onScroll={handleListScroll}
          onClick={input.onSelectionInteraction}
          class="relative min-w-0 w-full h-full"
          style={{ "--sticky-accordion-top": input.showHeader() ? "48px" : "0px" }}
        >
          <Show when={input.showHeader()}>{props.header}</Show>
          <div
            data-timeline-virtual-content
            ref={(element) => {
              virtualContent = element
              input.setContentRef(element)
            }}
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
              visibility: coldBottomMount ? "hidden" : undefined,
            }}
          >
            <For each={virtualRowKeys()}>{(rowKey) => <VirtualRow rowKey={rowKey} />}</For>
            <Show when={rows().length > 0}>
              <div
                data-timeline-row="bottom-spacer"
                class="h-16 absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${virtualizer.getTotalSize() - 64}px)` }}
              >
                {props.bottomSpacer}
              </div>
            </Show>
          </div>
        </ScrollView>
      </div>
    )
  }

  onCleanup(() => {
    cache.delete(ownerSessionKey)
    cache.set(ownerSessionKey, { measurements: virtualizer.takeSnapshot(), toolOpen: { ...toolOpen } })
    while (cache.size > 16) cache.delete(cache.keys().next().value!)
    if (settleFrame !== undefined) cancelAnimationFrame(settleFrame)
    if (overscanFrame !== undefined) cancelAnimationFrame(overscanFrame)
    if (overscanTimer !== undefined) window.clearTimeout(overscanTimer)
    input.setScrollRef(undefined)
    input.setRevealMessage?.(() => {})
    input.setScrollToEnd?.(() => {})
  })

  return {
    disclosure: {
      value: (key: string) => toolOpen[key],
      set: (key: string, open: boolean) => setToolOpen(key, open),
    },
    View,
  }
}
