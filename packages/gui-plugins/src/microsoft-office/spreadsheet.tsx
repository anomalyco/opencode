import { createMemo, createSignal, createUniqueId, For, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Loader } from "@opencode/ui/loader"
import { showToast } from "@opencode/ui/toast"
import {
  cellAtPoint,
  extendTo,
  hyperlinkAtCell,
  normalizeRange,
  parseHyperlinkLocation,
  rangeRect,
  safeExternalHyperlink,
  selectionAt,
  selectionKeyReducer,
  type CellAddr,
  type DisplayList,
  type GridMeta,
  type HyperlinkRegion,
  type Selection,
  type SelectionLimits,
} from "@betteroffice/xlsx/headless"
import { createKeyed, createLatest, usePlugin } from "@opencode/plugin/gui"
import type { FileViewerProps } from "@opencode/plugin/gui/file"
import { externalUrl } from "./links"
import { paper } from "./paper"
import { columnName, contains, coverMerges, hiddenAt, lastCell, settleMerges, skipHidden } from "./sheet-cells"
import {
  headerHeight,
  paintCells,
  paintHeaders,
  paintSelection,
  rowHeaderWidth,
  shiftGrid,
  trackIndex,
} from "./sheet-paint"
import {
  createSheetFrameState,
  needsSheetOpen,
  sheetEnd,
  sheetFrameNeeded,
  sheetMoving,
  sheetPainted,
  sheetPaintFailed,
  transitionSheetFrame,
  type SheetFrameEffect,
  type SheetFrameEvent,
} from "./sheet-frame-machine"
import {
  createSheetPickState,
  sheetActiveTab,
  sheetShown,
  sheetShownIndex,
  transitionSheetPick,
  type SheetPickEffect,
  type SheetPickEvent,
} from "./sheet-pick-machine"
import {
  IDLE_SHEET_POINTER_STATE,
  sheetPointerMoveNeeded,
  transitionSheetPointer,
  type SheetHit,
  type SheetPointerEffect,
  type SheetPointerEvent,
  type SheetPointerMoved,
  type SheetPointerState,
} from "./sheet-pointer-machine"
import type { SheetFrameRequest, SheetLayout, SheetMethods, SheetTab } from "./sheet-protocol"
import { createOfficeWorker, type WorkerClient } from "./office-worker"
import { WorkerClosedError } from "./worker-rpc"

/** The workbook worker's end in the window. */
type Client = WorkerClient<SheetMethods>

/** An opened workbook: its worker, its visible sheets and the layout of the sheet it opened on. */
type Opened = { readonly client: Client; readonly tabs: readonly SheetTab[]; readonly layout: SheetLayout }

/** One worker call that has not answered yet, and its timeout. */
type PendingCall = { readonly controller: AbortController; readonly timer: number }

/** The timer that ends a scroll once no scroll event came for the settle delay. */
type FrameTimers = { settle: number }

/** The one pointer move event a grid dispatches, written in place so moves allocate nothing. */
type MoveEvent = { -readonly [K in keyof SheetPointerMoved]: SheetPointerMoved[K] }

/** The pointer's position past the headers, in CSS pixels, written in place by each hit test. */
type PointerSpot = { x: number; y: number }

/** The most cells one copy reads; a larger selection would hold the workbook worker for seconds. */
const copyLimit = 200_000

/**
 * The cells screen readers can browse: a block around the active cell that moves with it a step at a time, so a key
 * press rarely rebuilds it and a sheet of any density costs a few hundred cells.
 */
const readerBlock = { rows: 10, cols: 5 }

/** A read-only Excel workbook with a tab per visible sheet. */
export default function OfficeSpreadsheet(props: FileViewerProps) {
  const ctx = usePlugin()

  const viewer = createOfficeWorker<SheetMethods, Opened>({
    bytes: () => props.bytes,
    createWorker: () => new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), { type: "module" }),
    open: async (client, buffer, signal) => {
      const opened = await client.call("open", { bytes: buffer }, { transfer: [buffer], signal })

      if (!opened) return undefined

      return {
        value: { client, tabs: opened.tabs, layout: opened.layout },
        details: [ctx.plural("sheets", opened.tabs.length)],
      }
    },
    onDetails: (details) => props.onDetails(details),
    onError: () => props.onError(),
  })

  return (
    <Show
      when={viewer.opened()}
      keyed
      fallback={
        <Show when={viewer.loading()}>
          <div class="flex min-h-0 flex-1 items-center justify-center">
            <Loader />
          </div>
        </Show>
      }
    >
      {(opened) => <SpreadsheetWorkbook opened={opened.value} />}
    </Show>
  )
}

/** One opened workbook: its sheet tabs and the grid of the sheet on show. A reloaded file mounts a new one. */
function SpreadsheetWorkbook(props: { opened: Opened }) {
  const ctx = usePlugin()
  const panel = createUniqueId()

  // The sheet on show, and the tab the user picked while its sheet opens in the worker.
  const [pickState, setPickState] = createSignal(createSheetPickState(props.opened.layout))
  // The show calls still running, by attempt.
  const calls = new Map<number, PendingCall>()
  const shown = createMemo(() => sheetShown(pickState()))
  const active = createMemo(() => sheetActiveTab(pickState()))

  const dispatch = (event: SheetPickEvent) => {
    const next = transitionSheetPick(untrack(pickState), event)

    setPickState(() => next.state)
    next.effects.forEach(run)
  }

  const run = (effect: SheetPickEffect) => {
    if (effect.type === "request-show") return requestShow(effect.attempt, effect.sheet, effect.timeoutMs)

    if (effect.type === "abort-show") {
      const call = calls.get(effect.attempt)

      calls.delete(effect.attempt)
      clearTimeout(call?.timer)
      call?.controller.abort()

      return
    }

    showToast({ title: ctx.t("sheet.openFailed") })
  }

  const requestShow = (attempt: number, sheet: number, timeoutMs: number) => {
    const call: PendingCall = {
      controller: new AbortController(),
      timer: window.setTimeout(() => dispatch({ type: "show.timed-out", attempt }), timeoutMs),
    }

    const settle = () => {
      clearTimeout(call.timer)
      calls.delete(attempt)
    }

    calls.set(attempt, call)
    void props.opened.client.call("show", { sheet }, { signal: call.controller.signal }).then(
      (layout) => {
        settle()
        dispatch({ type: "show.succeeded", attempt, layout })
      },
      (error: Error) => {
        settle()
        // A stopped worker reports itself through the viewer, so the pick ends without a second notice.
        dispatch({ type: "show.failed", attempt, closed: error instanceof WorkerClosedError })
      },
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  const show = (index: number, target?: CellAddr) => dispatch({ type: "sheet.picked", sheet: index, target })

  // A link to a hidden or missing sheet goes nowhere, as in Excel.
  const navigate = (name: string, cell: CellAddr) => {
    const tab = props.opened.tabs.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())

    if (tab) show(tab.index, cell)
  }

  // The arrow keys move between the sheet tabs and open the one they reach; only the open tab is in the Tab order.
  const roam = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    const tabs = props.opened.tabs
    const current = tabs.findIndex((tab) => tab.index === active())
    const forward = getComputedStyle(event.currentTarget).direction === "rtl" ? "ArrowLeft" : "ArrowRight"
    const backward = forward === "ArrowRight" ? "ArrowLeft" : "ArrowRight"

    const position = (() => {
      if (event.key === "Home") return 0

      if (event.key === "End") return tabs.length - 1

      if (event.key === forward) return (current + 1) % tabs.length

      if (event.key === backward) return (current - 1 + tabs.length) % tabs.length

      return undefined
    })()

    const tab = position === undefined ? undefined : tabs[position]

    if (position === undefined || !tab) return

    event.preventDefault()
    show(tab.index)
    event.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")[position]?.focus()
  }

  const tabID = (index: number | undefined) => `${panel}-tab-${index}`

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div
        id={panel}
        role={props.opened.tabs.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={props.opened.tabs.length > 1 ? tabID(sheetShownIndex(pickState())) : undefined}
        class="flex min-h-0 flex-1"
      >
        {/* Each sheet gets its own grid, so its selection and scroll position start fresh. */}
        <Show when={shown()} keyed>
          {(shown) => (
            <SpreadsheetGrid
              client={props.opened.client}
              layout={shown.layout}
              target={shown.target}
              onNavigate={navigate}
            />
          )}
        </Show>
      </div>
      <Show when={props.opened.tabs.length > 1}>
        <div
          role="tablist"
          aria-label={ctx.t("sheet.tabs")}
          class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-v2-border-border-muted px-2"
          onKeyDown={roam}
        >
          <For each={props.opened.tabs}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                id={tabID(tab.index)}
                aria-controls={panel}
                aria-selected={tab.index === active()}
                tabIndex={tab.index === active() ? 0 : -1}
                class="h-7 shrink-0 rounded-md px-2.5 text-13-regular text-text-weak hover:bg-v2-background-bg-layer-02 aria-selected:bg-v2-background-bg-layer-02 aria-selected:text-text-strong"
                onClick={() => show(tab.index)}
              >
                {tab.name}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

/**
 * The active sheet as one canvas the size of the pane, with row and column headers along its edges. The workbook worker
 * paints the cells under the scroll position, frozen panes included, so a sheet of any size costs one viewport; the
 * window draws that bitmap with the headers and the selection over it. The scroll coordinates are the engine's: the
 * frozen panes stay put while the rest scrolls beside them.
 */
function SpreadsheetGrid(props: {
  client: Client
  layout: SheetLayout
  target: CellAddr | undefined
  onNavigate: (sheet: string, cell: CellAddr) => void
}) {
  const ctx = usePlugin()
  const id = createUniqueId()
  const controller = new AbortController()
  let scroller: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let frame = 0
  // The frame on screen's grid and links where the screen shows them, which pointer hits and links read.
  let shown: { grid: GridMeta | undefined; links: DisplayList } | undefined
  // The pointer gesture: what a pointer that is down drags across, and the cell a click without a drag follows.
  const [pointerState, setPointerState] = createSignal<SheetPointerState>(IDLE_SHEET_POINTER_STATE)

  // Built once: every pointer move during a drag writes them in place.
  const moveEvent: MoveEvent = {
    type: "pointer.moved",
    pointerId: 0,
    buttons: 0,
    row: -1,
    col: -1,
    focusRow: 0,
    focusCol: 0,
  }

  const spot: PointerSpot = { x: 0, y: 0 }
  // The frames the worker draws, which the newest reply on screen stays until the next replaces it.
  const [frameState, setFrameState] = createSignal(createSheetFrameState())
  // The frame calls still running, and the timer that ends scrolling.
  const calls = new Map<number, PendingCall>()
  const timers: FrameTimers = { settle: 0 }
  // Built once: the scroll path dispatches them on every event.
  const scrollEvent: SheetFrameEvent = { type: "scroll" }
  const settledEvent: SheetFrameEvent = { type: "scroll.settled" }

  onCleanup(() => controller.abort())

  // The last paint, in the engine's scroll coordinates: the scroll position, the size of the cells beside the headers,
  // the frozen panes', the row headers' width, and the farthest point a jump asked for.
  const [view, setView] = createStore({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    frozenWidth: 0,
    frozenHeight: 0,
    header: 0,
    reachX: 0,
    reachY: 0,
  })

  // Where the sheet's last cell ends, past the frozen panes, as the frame on screen reports it. A viewport past it
  // makes the engine throw.
  const end = createMemo(() => sheetEnd(frameState()), undefined, {
    equals: (previous, next) => previous?.x === next?.x && previous?.y === next?.y,
  })

  const paintFailed = createMemo(() => sheetPaintFailed(frameState()))

  const [state, setState] = createStore<{
    selection: Selection
    hover: { cursor: string; title: string | undefined }
  }>({
    selection: selectionAt({ row: 0, col: 0 }),
    hover: { cursor: "default", title: undefined },
  })

  const [ratio, setRatio] = createSignal(window.devicePixelRatio || 1)

  const info = () => props.layout.info
  const sheet = () => info().activeSheet
  const name = () => info().sheetNames[sheet()] ?? ""
  const frozen = () => ({ rows: info().frozenRows, cols: info().frozenCols })

  // As in Excel, the sheet scrolls one screen past the farthest point seen, up to its last cell.
  const area = () => {
    const limit = end()

    const width = Math.max(
      info().contentWidth,
      props.layout.chartWidth + view.frozenWidth,
      view.reachX,
      view.left + view.width,
    )

    const height = Math.max(
      info().contentHeight,
      props.layout.chartHeight + view.frozenHeight,
      view.reachY,
      view.top + view.height,
    )

    return {
      width: view.header + Math.min(limit ? limit.x + view.frozenWidth : Infinity, width + view.width),
      height: headerHeight + Math.min(limit ? limit.y + view.frozenHeight : Infinity, height + view.height),
    }
  }

  const selected = createMemo(() => coverMerges(normalizeRange(state.selection), props.layout.merges))

  const paint = () => {
    if (!scroller || !canvas) return

    const context = canvas.getContext("2d")

    if (!context) return

    const ratio = window.devicePixelRatio || 1
    const width = scroller.clientWidth
    const height = scroller.clientHeight
    const headers = { width: view.header || rowHeaderWidth(context, 99), height: headerHeight }
    const size = { width: width - headers.width, height: height - headers.height }

    if (size.width <= 0 || size.height <= 0) return

    if (needsSheetOpen(untrack(frameState))) dispatch({ type: "sheet.opened", width: size.width, height: size.height })

    const limit = end()
    const left = clamp(scroller.scrollLeft, limit ? limit.x + view.frozenWidth - size.width : Infinity)
    const top = clamp(scroller.scrollTop, limit ? limit.y + view.frozenHeight - size.height : Infinity)

    // While the sheet scrolls, frames reach past the screen, so the next scroll still shows cells while its own frame
    // renders. Once it settles, a frame of the screen alone replaces it.
    const margin = { x: Math.round(size.width / 4), y: Math.round(size.height / 2) }
    const moving = sheetMoving(untrack(frameState))
    const x = Math.max(0, left - margin.x)
    const y = Math.max(0, top - margin.y)

    const input: SheetFrameRequest = {
      sheet: sheet(),
      x: left,
      y: top,
      ...size,
      ratio,
      offset: { x: fraction(headers.width * ratio), y: fraction(headers.height * ratio) },
      wider:
        moving && limit
          ? {
              x,
              y,
              width: Math.min(left + size.width + margin.x, limit.x + view.frozenWidth) - x,
              height: Math.min(top + size.height + margin.y, limit.y + view.frozenHeight) - y,
            }
          : undefined,
    }

    // While the sheet scrolls, a frame that still reaches half its margin past the screen serves on, so the worker
    // paints the next one only as the scroll nears its edge.
    const needed = limit && {
      x: Math.max(0, left - margin.x / 2),
      y: Math.max(0, top - margin.y / 2),
      right: Math.min(left + size.width + margin.x / 2, limit.x + view.frozenWidth),
      bottom: Math.min(top + size.height + margin.y / 2, limit.y + view.frozenHeight),
    }

    // Only the newest request waits its turn in the worker: a scroll that outruns it skips the frames in between.
    if (sheetFrameNeeded(untrack(frameState), input, needed)) dispatch({ type: "frame.requested", request: input })

    const painted = sheetPainted(untrack(frameState))

    // Until the first frame arrives the paper shows.
    if (!painted) return setView({ left, top, ...size })

    // A new backing size reallocates the canvas, so it changes only with the pane or the display; each paint below
    // covers every pixel.
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }

    paintCells(context, painted, { ratio, headers, x: left, y: top, ...size })

    const panes = painted.frame.frozen
    const drawn = painted.frame.viewport

    const grid =
      painted.frame.grid && shiftGrid(painted.frame.grid, frozen(), panes, { x: drawn.x - left, y: drawn.y - top })

    shown = { grid, links: { width: 0, height: 0, commands: [], hyperlinks: [...painted.frame.hyperlinks] } }

    if (grid) {
      const anchor = state.selection.anchor

      paintSelection(context, {
        grid,
        ratio,
        headers,
        ...size,
        range: selected(),
        active: coverMerges(
          { top: anchor.row, left: anchor.col, bottom: anchor.row, right: anchor.col },
          props.layout.merges,
        ),
      })
      paintHeaders(context, { grid, ratio, headers, width, height, selected: selected() })
    }

    // The last row on screen; a frame with a margin holds rows past it.
    const last = grid
      ? grid.rowOffsets.findLastIndex(
          (offset, position) => position < grid.rowOffsets.length - 1 && offset < size.height,
        )
      : -1

    const header = rowHeaderWidth(context, grid ? trackIndex(grid.startRow, grid.rowIndices, Math.max(0, last)) + 1 : 1)

    setView({ left, top, ...size, frozenWidth: panes.width, frozenHeight: panes.height, header })

    // Longer row numbers widen the row headers, which narrows the cells: draw again at the new width.
    if (header !== headers.width) schedule()
  }

  const dispatch = (event: SheetFrameEvent) => {
    const next = transitionSheetFrame(untrack(frameState), event)

    setFrameState(() => next.state)
    next.effects.forEach(run)
  }

  const run = (effect: SheetFrameEffect) => {
    if (effect.type === "schedule-paint") return schedule()

    if (effect.type === "restart-settle") {
      clearTimeout(timers.settle)
      timers.settle = window.setTimeout(() => dispatch(settledEvent), effect.delayMs)

      return
    }

    if (effect.type === "request-frame") return requestFrame(effect.attempt, effect.request, effect.timeoutMs)

    if (effect.type === "abort-frame") return calls.get(effect.attempt)?.controller.abort()

    if (effect.type === "close-frame") return effect.frame.bitmap.close()

    if (effect.type === "open-sheet") {
      setView({ width: effect.width, height: effect.height })
      open()

      return
    }

    clearTimeout(timers.settle)
    cancelAnimationFrame(frame)
    calls.forEach((call) => {
      clearTimeout(call.timer)
      call.controller.abort()
    })
    calls.clear()
  }

  // Asks the worker for the frame under the scroll position. A newer request with the same key replaces one that
  // still waits there; one that runs finishes, and shows while the newer renders.
  const requestFrame = (attempt: number, request: SheetFrameRequest, timeoutMs: number) => {
    const call: PendingCall = {
      controller: new AbortController(),
      timer: window.setTimeout(() => dispatch({ type: "frame.timed-out", attempt }), timeoutMs),
    }

    const settle = () => {
      clearTimeout(call.timer)
      calls.delete(attempt)
    }

    calls.set(attempt, call)
    void props.client.call("frame", request, { key: "frame", signal: call.controller.signal }).then(
      (reply) => {
        settle()
        // Cells the engine cannot draw here leave the last frame on screen, with a notice.
        dispatch(
          reply ? { type: "frame.succeeded", attempt, request, frame: reply } : { type: "frame.failed", attempt },
        )
      },
      () => {
        settle()
        dispatch({ type: "frame.failed", attempt })
      },
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  // A scroll draws frames with a margin until it settles, when one more paint draws the screen alone.
  const scrolled = () => dispatch(scrollEvent)

  // One paint per frame, however many scroll, resize and pointer events arrive in it.
  const schedule = () => {
    if (frame) return

    frame = requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }

  createResizeObserver(() => scroller, schedule)

  // Syncs with the display's pixel ratio, which changes at the same CSS size when the window moves to another screen. A
  // media query matches one ratio, so each new ratio arms a new one.
  createKeyed(ratio, (value) => {
    const query = window.matchMedia(`(resolution: ${value}dppx)`)

    const change = () => {
      setRatio(window.devicePixelRatio || 1)
      schedule()
    }

    query.addEventListener("change", change)
    onCleanup(() => query.removeEventListener("change", change))
  })

  // The block of cells around the active cell that the screen reader grid holds, which moves a step at a time.
  const block = createMemo(
    () => {
      const focus = state.selection.focus
      const top = Math.max(0, (Math.floor(focus.row / readerBlock.rows) - 1) * readerBlock.rows)
      const left = Math.max(0, (Math.floor(focus.col / readerBlock.cols) - 1) * readerBlock.cols)

      return {
        top,
        left,
        bottom: Math.min(lastCell.row, top + readerBlock.rows * 3 - 1),
        right: Math.min(lastCell.col, left + readerBlock.cols * 3 - 1),
      }
    },
    undefined,
    { equals: (previous, next) => previous.top === next.top && previous.left === next.left },
  )

  const reading = createLatest(block, (range, signal) =>
    props.client.call("cells", { sheet: sheet(), range }, { signal }).then((texts) => ({ range, texts })),
  )

  // The block's cells as they show, for screen readers, without the hidden rows and columns.
  const readable = createMemo(() => {
    const read = reading.latest

    if (!read) return { columns: [], rows: [] }

    const range = read.range
    const hidden = props.layout.hidden
    const tracks = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, step) => first + step)
    const columns = tracks(range.left, range.right).filter((col) => !hiddenAt(hidden.columns, col))

    return {
      columns,
      rows: tracks(range.top, range.bottom)
        .filter((row) => !hiddenAt(hidden.rows, row))
        .map((row) => ({
          row,
          cells: columns.map((col) => ({ row, col, text: read.texts[row - range.top]?.[col - range.left] ?? "" })),
        })),
    }
  })

  const cellID = (cell: CellAddr) => `${id}-${cell.row}-${cell.col}`

  // The cell keyboard moves reach, which screen readers announce: the active cell, or the far corner of a selection the
  // keys extend.
  const activeCell = () => {
    const focus = state.selection.focus
    const grid = readable()

    if (!grid.columns.includes(focus.col) || !grid.rows.some((row) => row.row === focus.row)) return undefined

    return cellID(focus)
  }

  // Scrolls to where the workbook last showed the sheet, or to the cell a link opened it on.
  const open = () => {
    const target = props.target

    // A link in the previous sheet's grid opened this one: keep the keyboard in the grid.
    if (target) {
      scroller?.focus({ preventScroll: true })
      select(at(target))
      reveal(target, "start")

      return
    }

    setView({ reachX: info().initialScrollX + view.width, reachY: info().initialScrollY + view.height })
    scroller?.scrollTo({ left: info().initialScrollX, top: info().initialScrollY })
  }

  const select = (selection: Selection) => {
    setState("selection", selection)
    schedule()
  }

  // One cell selected; a merged cell selects from its first cell.
  const at = (cell: CellAddr) => {
    const merge = props.layout.merges.find((candidate) => contains(candidate, cell))

    return selectionAt(merge ? { row: merge.top, col: merge.left } : cell)
  }

  // Scrolls a cell into view, past the frozen panes; a cell inside them is always in view. A cell the frame on screen
  // shows whole is in view already, which saves asking the worker where it is.
  const reveal = (cell: CellAddr, align: "start" | "nearest") => {
    if (!scroller || (align === "nearest" && whole(cell))) return

    // A plain copy: the cell may come from a store, whose proxy cannot cross to the worker.
    const target = { row: cell.row, col: cell.col }

    void props.client
      .call("position", { sheet: sheet(), cell: target }, { key: "position", signal: controller.signal })
      .then(
        (position) => {
          if (!scroller || !position) return

          const start = position.start
          const next = position.next

          const left =
            cell.col < info().frozenCols
              ? scroller.scrollLeft
              : place(start.x, next.x - start.x, scroller.scrollLeft, view.width - view.frozenWidth, align)

          const top =
            cell.row < info().frozenRows
              ? scroller.scrollTop
              : place(start.y, next.y - start.y, scroller.scrollTop, view.height - view.frozenHeight, align)

          // Grow the scroll area first, so the scroll is not cut short at its current edge.
          setView({ reachX: left + view.width, reachY: top + view.height })
          scroller.scrollTo({ left, top })
        },
        () => undefined,
      )
  }

  // Whether the screen shows a cell whole and clear of the panes, as the frame on it tells.
  const whole = (cell: CellAddr) => {
    const grid = shown?.grid

    if (!grid) return false

    const rect = rangeRect(grid, { top: cell.row, left: cell.col, bottom: cell.row, right: cell.col })

    if (!rect) return false

    // A cell in the panes keeps the scroll along that side. Past them, a track that starts on the panes' edge may run
    // on under them, so only one that starts after it is surely whole.
    const clear = (start: number, pane: number, frozen: boolean) => frozen || (pane > 0 ? start > pane : start >= 0)

    return (
      clear(rect.x, view.frozenWidth, cell.col < info().frozenCols) &&
      clear(rect.y, view.frozenHeight, cell.row < info().frozenRows) &&
      rect.x + rect.w <= view.width &&
      rect.y + rect.h <= view.height
    )
  }

  // The cell under a pointer; where the pointer is past the headers lands in `spot`. While dragging, a pointer past the
  // cells holds to the nearest one.
  const locate = (event: PointerEvent, held: boolean): CellAddr | undefined => {
    const grid = shown?.grid

    if (!grid || !canvas) return undefined

    const rect = canvas.getBoundingClientRect()

    spot.x = event.clientX - rect.left - view.header
    spot.y = event.clientY - rect.top - headerHeight

    if (!held && (spot.x >= view.width || spot.y >= view.height)) return undefined

    const cell = cellAtPoint(
      grid,
      Math.min(Math.max(spot.x, 0), view.width - 1, (grid.colOffsets[grid.colOffsets.length - 1] ?? 0) - 1),
      Math.min(Math.max(spot.y, 0), view.height - 1, (grid.rowOffsets[grid.rowOffsets.length - 1] ?? 0) - 1),
    )

    if (!cell) return undefined

    return cell
  }

  // Where a pointer went down: a cell, a whole row or column, or the corner that selects all.
  const hit = (event: PointerEvent): SheetHit | undefined => {
    const cell = locate(event, false)

    if (!cell) return undefined

    if (spot.x < 0 && spot.y < 0) return { kind: "all", cell }

    if (spot.y < 0) return { kind: "column", cell }

    if (spot.x < 0) return { kind: "row", cell }

    return { kind: "cell", cell }
  }

  const dispatchPointer = (event: SheetPointerEvent) => {
    const next = transitionSheetPointer(untrack(pointerState), event)

    setPointerState(() => next.state)
    next.effects.forEach(runPointer)
  }

  const runPointer = (effect: SheetPointerEffect) => {
    if (effect.type === "capture-pointer") return scroller?.setPointerCapture(effect.pointerId)

    if (effect.type === "follow-link") return follow(effect.cell)

    const anchor = state.selection.anchor

    // A whole row or column keeps its far end as the anchor, so the arrow keys move on from its first cell.
    if (effect.type === "select-all")
      return select({ anchor: { row: lastCell.row, col: lastCell.col }, focus: { row: 0, col: 0 } })

    if (effect.type === "select-column")
      return select({
        anchor: { row: lastCell.row, col: effect.extend ? anchor.col : effect.col },
        focus: { row: 0, col: effect.col },
      })

    if (effect.type === "select-row")
      return select({
        anchor: { row: effect.extend ? anchor.row : effect.row, col: lastCell.col },
        focus: { row: effect.row, col: 0 },
      })

    if (effect.type === "select-cell")
      return select(effect.extend ? extendTo(state.selection, effect.cell) : at(effect.cell))

    // A drag moves the selection's far corner: to the cell under the pointer, or along the row or column headers.
    select({ anchor, focus: effect.focus })
  }

  onCleanup(() => dispatchPointer({ type: "disposed" }))

  const press = (event: PointerEvent) =>
    dispatchPointer({
      type: "pointer.down",
      pointerId: event.pointerId,
      button: event.button,
      shift: event.shiftKey,
      hit: event.button === 0 ? hit(event) : undefined,
    })

  // Runs on every pointer move: a drag dispatches only when the move changes something, and hovering writes the cursor
  // and tooltip only when they change.
  const move = (event: PointerEvent) => {
    const current = untrack(pointerState)

    if (current.status === "dragging") {
      if (current.pointerId !== event.pointerId) return

      moveEvent.pointerId = event.pointerId
      moveEvent.buttons = event.buttons
      moveEvent.focusRow = state.selection.focus.row
      moveEvent.focusCol = state.selection.focus.col

      if ((event.buttons & 1) !== 0) {
        chase(current.axis, event)

        const cell = locate(event, true)

        moveEvent.row = cell ? cell.row : -1
        moveEvent.col = cell ? cell.col : -1
      }

      if (sheetPointerMoveNeeded(current, moveEvent)) dispatchPointer(moveEvent)

      return
    }

    const cell = locate(event, false)
    const over = cell && spot.x >= 0 && spot.y >= 0 ? cell : undefined
    const link = over && linkAt(over)
    const cursor = over ? (link ? "pointer" : "cell") : "default"
    const title = link ? linkTitle(link) : undefined

    if (cursor !== state.hover.cursor) setState("hover", "cursor", cursor)

    if (title !== state.hover.title) setState("hover", "title", title)
  }

  // A drag past the cells' edge scrolls the sheet toward the pointer, by how far past the edge it is. Along the headers
  // it scrolls only along them.
  const chase = (kind: "cells" | "rows" | "columns", event: PointerEvent) => {
    if (!scroller || !canvas) return

    const rect = canvas.getBoundingClientRect()
    const past = (point: number, start: number, end: number) => Math.min(0, point - start) + Math.max(0, point - end)

    scroller.scrollBy(
      kind === "rows" ? 0 : past(event.clientX, rect.left + view.header, rect.right),
      kind === "columns" ? 0 : past(event.clientY, rect.top + headerHeight, rect.bottom),
    )
  }

  const release = (event: PointerEvent) =>
    dispatchPointer({ type: "pointer.up", pointerId: event.pointerId, cell: locate(event, false) })

  // A cancelled pointer, or one whose capture another element or the window took, ends its drag.
  const cancel = (event: PointerEvent) => dispatchPointer({ type: "pointer.cancelled", pointerId: event.pointerId })

  // The followable link on a cell; a merged cell's link sits on its first cell.
  const linkAt = (cell: CellAddr): HyperlinkRegion | undefined => {
    if (!shown) return undefined

    const origin = at(cell).anchor
    const link = hyperlinkAtCell(shown.links, origin.row, origin.col)

    if (!link) return undefined

    if (sheetLinkUrl(link) || (link.location && parseHyperlinkLocation(link.location, name()))) return link

    return undefined
  }

  const follow = (cell: CellAddr) => {
    const link = linkAt(cell)

    if (!link) return

    const url = sheetLinkUrl(link)

    if (url) return ctx.system.openExternal(url)

    const target = link.location ? parseHyperlinkLocation(link.location, name()) : null

    if (!target) return

    const destination = { row: target.row, col: target.col }

    if (target.sheetName.toLowerCase() !== name().toLowerCase()) return props.onNavigate(target.sheetName, destination)

    select(at(destination))
    reveal(destination, "start")
  }

  const limits = (bounded: boolean): SelectionLimits => {
    const rowsPerPage = Math.max(1, Math.floor((view.height - view.frozenHeight) / 20))

    if (!bounded) return { rows: lastCell.row + 1, cols: lastCell.col + 1, rowsPerPage }

    // Jumps to an edge stop at the used cells, or where the active cell already is past them.
    const used = props.layout.used
    const focus = state.selection.focus

    return {
      rows: Math.max((used?.bottom ?? 0) + 1, focus.row + 1),
      cols: Math.max((used?.right ?? 0) + 1, focus.col + 1),
      rowsPerPage,
    }
  }

  const key = (event: KeyboardEvent) => {
    const command = event.ctrlKey || event.metaKey

    if (command && !event.altKey && event.key.toLowerCase() === "c") {
      event.preventDefault()
      copy()

      return
    }

    // Tab leaves the grid for the next control rather than moving the active cell, and Alt keeps its browser meaning.
    if (event.key === "Tab" || event.altKey || event.isComposing) return

    // Enter follows a link on the active cell, as a click does; on any other cell it moves down, as in Excel.
    if (event.key === "Enter" && !event.shiftKey && !command && linkAt(state.selection.anchor)) {
      event.preventDefault()
      follow(state.selection.anchor)

      return
    }

    // As in Excel, Ctrl+Home goes to the first cell past the frozen panes and scrolls back to the start.
    if (command && event.key === "Home") {
      const home = { row: info().frozenRows, col: info().frozenCols }

      event.preventDefault()
      select(at(home))
      reveal(home, "start")

      return
    }

    const bounded =
      event.key === "Home" ||
      event.key === "End" ||
      (command && (event.key.startsWith("Arrow") || event.key.toLowerCase() === "a"))

    const action = selectionKeyReducer(
      state.selection,
      {
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
      },
      limits(bounded),
    )

    // The viewer is read-only: keys that would edit or clear cells do nothing.
    if (action.type !== "move") return

    event.preventDefault()

    const next = skipHidden(
      state.selection.focus,
      settleMerges(state.selection, action.selection, props.layout.merges),
      props.layout.hidden,
    )

    select(next)

    // Selecting everything leaves the view where it is, as in Excel.
    if (!(command && event.key.toLowerCase() === "a")) reveal(next.focus, "nearest")
  }

  // Copies the cells as they show, which the worker reads and joins as tab-separated text.
  const copy = () => {
    const range = selected()
    const used = props.layout.used

    const clipped = {
      top: range.top,
      left: range.left,
      bottom: Math.min(range.bottom, Math.max(range.top, used?.bottom ?? 0)),
      right: Math.min(range.right, Math.max(range.left, used?.right ?? 0)),
    }

    if ((clipped.bottom - clipped.top + 1) * (clipped.right - clipped.left + 1) > copyLimit)
      return showToast({ title: ctx.t("sheet.copyTooLarge") })

    const failed = () => {
      if (!controller.signal.aborted) showToast({ title: ctx.t("sheet.copyFailed") })
    }

    void props.client.call("copy", { sheet: sheet(), range: clipped }, { signal: controller.signal }).then(
      (text) => {
        if (text === undefined) return failed()

        return ctx.system.copy(text).catch(failed)
      },
      (error: Error) => {
        // A withdrawn copy or a stopped worker is quiet: the viewer reports a stopped worker itself.
        if (error instanceof WorkerClosedError) return

        failed()
      },
    )
  }

  return (
    <div class="relative flex min-h-0 flex-1 border-t border-v2-border-border-muted">
      {/* Grids keep their column order in right-to-left layouts, as spreadsheet apps do. */}
      {/* The scroller is the grid screen readers hear: its rows are the block around the active cell, which it points
          at as the active descendant, while the canvas shows the cells. */}
      <div
        ref={scroller}
        dir="ltr"
        tabIndex={0}
        role="grid"
        aria-label={name()}
        aria-readonly="true"
        aria-multiselectable="true"
        aria-rowcount={lastCell.row + 2}
        aria-colcount={lastCell.col + 2}
        aria-activedescendant={activeCell()}
        class="peer relative min-h-0 min-w-0 flex-1 select-none overflow-auto outline-none"
        // A sheet keeps its own colours in every theme, as Excel shows it.
        style={{ background: paper, cursor: state.hover.cursor }}
        title={state.hover.title}
        onScroll={scrolled}
        onKeyDown={key}
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        <div
          aria-hidden="true"
          class="pointer-events-none absolute left-0 top-0"
          style={{ width: `${area().width}px`, height: `${area().height}px` }}
        />
        <div aria-hidden="true" class="sticky left-0 top-0 h-0 w-0">
          <canvas ref={canvas} class="absolute left-0 top-0 block" />
        </div>
        <div class="sr-only">
          <div role="row" aria-rowindex={1}>
            <span role="columnheader" aria-colindex={1} />
            <For each={readable().columns}>
              {(col) => (
                <span role="columnheader" aria-colindex={col + 2}>
                  {columnName(col)}
                </span>
              )}
            </For>
          </div>
          <For each={readable().rows}>
            {(row) => (
              <div role="row" aria-rowindex={row.row + 2}>
                <span role="rowheader" aria-colindex={1}>
                  {row.row + 1}
                </span>
                <For each={row.cells}>
                  {(cell) => (
                    <span
                      role="gridcell"
                      id={cellID(cell)}
                      aria-colindex={cell.col + 2}
                      aria-selected={contains(selected(), cell)}
                    >
                      {cell.text}
                    </span>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
      {/* The canvas would cover the scroller's own outline, so the focus ring is laid over both. */}
      <div class="pointer-events-none absolute inset-0 peer-focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]" />
      <Show when={paintFailed()}>
        <div
          role="status"
          class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-v2-background-bg-base px-3 py-1.5 text-12-regular text-v2-text-text-muted shadow-[var(--v2-elevation-raised)]"
        >
          {ctx.t("sheet.paintFailed")}
        </div>
      </Show>
    </div>
  )
}

/** What a link's tooltip shows: where it goes, under any text of its own, so the text cannot hide the target. */
function linkTitle(link: HyperlinkRegion) {
  const target = sheetLinkUrl(link) ?? link.location ?? ""

  if (!link.tooltip || link.tooltip === target) return target

  return `${link.tooltip}\n${target}`
}

/** A link's web or mail address: the engine's check, which lets `tel:` through, then the schemes the host opens. */
function sheetLinkUrl(link: HyperlinkRegion) {
  const url = safeExternalHyperlink(link)

  return url ? externalUrl(url) : undefined
}

/** Where to scroll so a cell shows: at the start, or just enough to bring it fully into view. */
function place(start: number, size: number, current: number, visible: number, align: "start" | "nearest") {
  if (align === "start" || start < current || size >= visible) return start

  if (start + size > current + visible) return start + size - visible

  return current
}

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(value, max))
}

/** The part of a length past its last whole device pixel. */
function fraction(value: number) {
  return value - Math.floor(value)
}
