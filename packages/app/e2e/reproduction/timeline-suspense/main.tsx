import { createResource, createSignal, For, onMount, Suspense } from "solid-js"
import { render } from "solid-js/web"
import { createVirtualizer, observeElementOffset, observeElementRect } from "@tanstack/solid-virtual"
import { observeElementOffsetReconnectAware } from "../../../src/pages/session/timeline/observe-element-offset"

const rowCount = 2_000
const rowHeight = 40
const parameters = new URLSearchParams(location.search)
const resourceMode = parameters.get("resource") === "guard" ? "guard" : "baseline"
const reconnectMode = parameters.get("reconnect") === "candidate" ? "candidate" : "baseline"

type MutationEvent = {
  kind: "removed" | "added"
  callbackTime: number
  callbackFrame: number
  routeConnectedInCallback: boolean
  nativeOffsetInCallback: number
}

type Snapshot = {
  mode: {
    resource: "baseline" | "guard"
    reconnect: "baseline" | "candidate"
  }
  operation: {
    sequence: number
    phase: string
    time: number
    frame: number
  }
  resourceState: string
  routeConnected: boolean
  viewportConnected: boolean
  viewportOwnedByRoute: boolean
  sameRoute: boolean
  sameViewport: boolean
  sameSurface: boolean
  sameMountedRows: boolean
  nativeOffset: number
  coreOffset: number
  rangeStart: number
  rangeEnd: number
  indexes: number[]
  domIndexes: number[]
  logicalSurfaceHeight: number
  renderedSurfaceHeight: number
  viewportClientHeight: number
  viewportScrollHeight: number
  visibleRows: number
  minimumRowTop: number
  domScrollEvents: number
  lastScrollTrusted: boolean
  coreOffsetCallbackCalls: number
  offsetCallbackSources: "observer"[]
  rectObserverCallbacks: number
  ignoredDetachedZeroRects: number
  syntheticScrollDispatches: number
  mutationEvents: MutationEvent[]
}

declare global {
  interface Window {
    timelineSuspense: {
      prepare: () => Promise<Snapshot>
      trigger: () => void
      resolve: () => void
      frames: (count?: number) => Promise<void>
      snapshot: () => Snapshot
    }
  }
}

function App() {
  const [refresh, setRefresh] = createSignal(false)
  let resolveResource: (() => void) | undefined
  const [resource] = createResource(
    refresh,
    (version) =>
      new Promise<string>((resolve) => {
        resolveResource = () => resolve(`settled-${version}`)
      }),
    { initialValue: "settled" },
  )

  function Route() {
    let route: HTMLElement | undefined
    let viewport: HTMLDivElement | undefined
    let surface: HTMLDivElement | undefined
    let initialRoute: HTMLElement | undefined
    let initialViewport: HTMLDivElement | undefined
    let initialSurface: HTMLDivElement | undefined
    let initialRows: HTMLElement[] = []
    let phase = "mounting"
    let browserFrame = 0
    let snapshotSequence = 0
    let domScrollEvents = 0
    let lastScrollTrusted = false
    let coreOffsetCallbackCalls = 0
    let rectObserverCallbacks = 0
    let ignoredDetachedZeroRects = 0
    const offsetCallbackSources: "observer"[] = []
    const mutationEvents: MutationEvent[] = []
    const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
      count: rowCount,
      getScrollElement: () => viewport ?? null,
      estimateSize: () => rowHeight,
      initialRect: { width: 900, height: 600 },
      overscan: 2,
      observeElementRect: (instance, callback) =>
        observeElementRect(instance, (rect) => {
          rectObserverCallbacks++
          // A fixed 600px viewport has no usable geometry while detached. Keep the last connected rect.
          if (!instance.scrollElement?.isConnected && rect.height === 0) {
            ignoredDetachedZeroRects++
            return
          }
          callback(rect)
        }),
      observeElementOffset: (instance, callback) => {
        const deliver = (offset: number, isScrolling: boolean) => {
          coreOffsetCallbackCalls++
          offsetCallbackSources.push("observer")
          callback(offset, isScrolling)
        }
        if (reconnectMode === "candidate") return observeElementOffsetReconnectAware(instance, deliver)
        return observeElementOffset(instance, deliver)
      },
    })

    const frames = async (count = 2) => {
      for (let index = 0; index < count; index++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }
    const mountedRows = () => [...(surface?.querySelectorAll<HTMLElement>("[data-row-index]") ?? [])]
    const snapshot = (): Snapshot => {
      const rows = mountedRows()
      const view = viewport?.getBoundingClientRect()
      const visibleRows =
        viewport?.isConnected && view
          ? rows.filter((row) => {
              const rect = row.getBoundingClientRect()
              return rect.bottom > view.top && rect.top < view.bottom
            }).length
          : 0
      return {
        mode: { resource: resourceMode, reconnect: reconnectMode },
        operation: {
          sequence: ++snapshotSequence,
          phase,
          time: performance.now(),
          frame: browserFrame,
        },
        resourceState: resource.state,
        routeConnected: route?.isConnected ?? false,
        viewportConnected: viewport?.isConnected ?? false,
        viewportOwnedByRoute: !!route && !!viewport && route.contains(viewport),
        sameRoute: route === initialRoute,
        sameViewport: viewport === initialViewport,
        sameSurface: surface === initialSurface,
        sameMountedRows:
          initialRows.length > 0 &&
          initialRows.length === rows.length &&
          initialRows.every((row, index) => row === rows[index]),
        nativeOffset: viewport?.scrollTop ?? -1,
        coreOffset: virtualizer.scrollOffset ?? -1,
        rangeStart: virtualizer.range?.startIndex ?? -1,
        rangeEnd: virtualizer.range?.endIndex ?? -1,
        indexes: virtualizer.getVirtualItems().map((item) => item.index),
        domIndexes: rows.map((row) => Number(row.dataset.rowIndex)),
        logicalSurfaceHeight: Number.parseFloat(surface?.style.height ?? "-1"),
        renderedSurfaceHeight: surface?.getBoundingClientRect().height ?? -1,
        viewportClientHeight: viewport?.clientHeight ?? -1,
        viewportScrollHeight: viewport?.scrollHeight ?? -1,
        visibleRows,
        minimumRowTop:
          rows.length && view ? Math.min(...rows.map((row) => row.getBoundingClientRect().top - view.top)) : -1,
        domScrollEvents,
        lastScrollTrusted,
        coreOffsetCallbackCalls,
        offsetCallbackSources: [...offsetCallbackSources],
        rectObserverCallbacks,
        ignoredDetachedZeroRects,
        syntheticScrollDispatches: 0,
        mutationEvents: mutationEvents.map((event) => ({ ...event })),
      }
    }

    onMount(() => {
      if (!route || !viewport || !surface) throw new Error("Timeline fixture did not mount")
      const routeRoot = route.parentElement
      if (!routeRoot) throw new Error("Timeline route root did not mount")
      initialRoute = route
      initialViewport = viewport
      initialSurface = surface
      viewport.addEventListener("scroll", (event) => {
        domScrollEvents++
        lastScrollTrusted = event.isTrusted
      })
      const countFrames = () => {
        browserFrame++
        requestAnimationFrame(countFrames)
      }
      requestAnimationFrame(countFrames)
      new MutationObserver((records) => {
        const callbackTime = performance.now()
        records.forEach((record) => {
          ;([...(record.removedNodes ?? [])] as Node[]).forEach((node) => {
            if (node !== route) return
            phase = "detached"
            mutationEvents.push({
              kind: "removed",
              callbackTime,
              callbackFrame: browserFrame,
              routeConnectedInCallback: route.isConnected,
              nativeOffsetInCallback: viewport.scrollTop,
            })
          })
          ;([...(record.addedNodes ?? [])] as Node[]).forEach((node) => {
            if (node !== route) return
            phase = "reinserted"
            mutationEvents.push({
              kind: "added",
              callbackTime,
              callbackFrame: browserFrame,
              routeConnectedInCallback: route.isConnected,
              nativeOffsetInCallback: viewport.scrollTop,
            })
          })
        })
      }).observe(routeRoot, { childList: true })
      window.timelineSuspense = {
        prepare: async () => {
          phase = "preparing"
          await frames(2)
          viewport.scrollTop = viewport.scrollHeight
          await frames(3)
          await new Promise((resolve) => setTimeout(resolve, 200))
          await frames(2)
          initialRows = mountedRows()
          phase = "prepared"
          return snapshot()
        },
        trigger: () => {
          phase = "triggering"
          setRefresh(true)
        },
        resolve: () => {
          if (!resolveResource) throw new Error("Resource is not pending")
          phase = "resolving"
          resolveResource()
        },
        frames,
        snapshot,
      }
    })

    return (
      <section ref={route} data-route style={{ width: "900px", margin: "0 auto" }}>
        <span aria-hidden="true" style={{ display: "none" }}>
          {resourceMode === "guard" && resource.state === "refreshing" ? resource.latest : resource()}
        </span>
        <div
          ref={viewport}
          data-viewport
          style={{
            height: "600px",
            overflow: "auto",
            "overflow-anchor": "none",
            position: "relative",
            background: "#202020",
            outline: "1px solid #3f3f46",
          }}
        >
          <div
            ref={surface}
            data-surface
            style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", "overflow-anchor": "none" }}
          >
            <For each={virtualizer.getVirtualItems()}>
              {(item) => (
                <div
                  data-row-index={item.index}
                  style={{
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: "100%",
                    height: `${item.size}px`,
                    transform: `translateY(${item.start}px)`,
                    padding: "10px 14px",
                    border: "0 solid #333",
                    "border-bottom-width": "1px",
                  }}
                >
                  logical row {item.index}
                </div>
              )}
            </For>
          </div>
        </div>
      </section>
    )
  }

  return (
    <main>
      <Suspense>
        <Route />
      </Suspense>
    </main>
  )
}

render(() => <App />, document.getElementById("root")!)
