import { TimelineRow } from "@opencode/session-ui/timeline/projection"
import { createComputed, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider } from "../src/runtime/i18n/language"
import { createTimelineFollow } from "../src/session/timeline/follow"
import { createTimelineVirtualizer } from "../src/session/timeline/virtualizer"

export function mountTimelineVirtualizer(input: {
  count: number
  rowHeight: number
  immediate?: boolean
  viewportHeight?: number
}) {
  const host = document.createElement("main")
  host.dataset.testid = "timeline-virtualizer-fixture"
  host.dataset.scrolls = "0"
  host.dataset.viewportResizes = "0"
  host.style.cssText = "position:fixed;top:24px;right:24px;width:400px;z-index:1000"
  document.body.appendChild(host)

  function Fixture() {
    const [state, setState] = createStore({ ready: false, grown: false })
    const follow = createTimelineFollow(() => "cold-reveal-fixture")

    const rows = Array.from(
      { length: input.count },
      (_, index) => new TimelineRow.UserMessage({ userMessageID: `message-${index}` }),
    )

    const rowByKey = new Map(rows.map((row) => [TimelineRow.key(row), row]))
    const indexes = new Map(rows.map((row, index) => [row.userMessageID, index]))
    let viewport!: HTMLDivElement
    let content!: HTMLDivElement
    let container!: HTMLDivElement
    let scrollToEnd = () => {}

    const timeline = createTimelineVirtualizer({
      sessionKey: () => "cold-reveal-fixture",
      projection: {
        rows: () => rows,
        rowByKey: () => rowByKey,
        activeMessageID: () => undefined,
        messageByID: () => new Map(),
        messageRowIndex: () => indexes,
        messageLastRowIndex: () => indexes,
      },
      showHeader: () => false,
      follow,
      scroll: () => ({ overflow: false, jump: false }),
      setScrollRef: (element) => {
        if (!element) return
        viewport = element
        resize.observe(element, { box: "border-box" })
      },
      onContentResize: () => {
        if (content) return
        content = host.querySelector<HTMLDivElement>("[data-timeline-virtual-content]")!
        reveal.observe(content, { attributes: true, attributeFilter: ["style"] })
      },
      onScheduleScrollState: (element) => {
        host.dataset.scrolls = String(Number(host.dataset.scrolls) + 1)
        host.dataset.lastScrollTop = String(element.scrollTop)
      },
      onResumeScroll: () => {},
      onUserScroll: () => {},
      onHistoryScroll: () => {},
      canRenderImmediately: () => input.immediate ?? false,
      setScrollToEnd: (fn) => {
        scrollToEnd = fn
      },
    })

    const resize = new ResizeObserver((entries) => {
      host.dataset.observedHeight = String(entries[0].borderBoxSize[0].blockSize)
      host.dataset.viewportResizes = String(Number(host.dataset.viewportResizes) + 1)
    })

    const reveal = new MutationObserver(() => {
      if (content.style.visibility === "hidden" || host.dataset.firstReveal) return
      // Capture the first reveal, not a later frame after geometry has recovered.
      const mounted = [...content.querySelectorAll<HTMLElement>("[data-timeline-key]")]
      host.dataset.firstReveal = JSON.stringify({
        rows: mounted.map((element) => Number(element.firstElementChild!.getAttribute("data-index"))),
        pendingMarkdown: content.querySelectorAll('[data-component="markdown"]:not([data-markdown-ready])').length,
        viewportHeight: viewport.clientHeight,
        scrollTop: viewport.scrollTop,
        clipped: mounted.flatMap((element) =>
          element.firstElementChild!.getBoundingClientRect().height > element.offsetHeight + 1
            ? [element.dataset.timelineKey]
            : [],
        ),
      })
    })

    onCleanup(() => {
      resize.disconnect()
      reveal.disconnect()
    })

    return (
      <div data-testid="timeline-controls" data-pinned={follow.following()} data-anchored={!!follow.anchor()}>
        <button type="button" onClick={() => setState("ready", true)}>
          Complete Markdown
        </button>
        <button type="button" onClick={() => (container.style.display = "none")}>
          Hide viewport
        </button>
        <button
          type="button"
          onClick={() => {
            const parent = viewport.parentElement!
            host.dataset.scrolls = "0"
            // Keep the same scroller and complete Markdown while it has no layout box.
            viewport.remove()
            viewport.scrollTop = 0
            setState("ready", true)
            parent.prepend(viewport)
            container.style.removeProperty("display")
          }}
        >
          Reconnect ready rows
        </button>
        <button type="button" onClick={() => scrollToEnd()}>
          Scroll to end
        </button>
        <button type="button" onClick={() => setState("grown", true)}>
          Grow last row
        </button>
        {/* A tool inside a group of several, which names them all on the group, as a reveal anchors it. */}
        <button
          type="button"
          onClick={() =>
            follow.dispatch({ type: "anchor", anchor: { key: TimelineRow.key(rows[0]!), partID: "prt_grouped" } })
          }
        >
          Anchor first row
        </button>
        <div ref={container} style={{ height: `${input.viewportHeight ?? 180}px`, width: "400px" }}>
          <timeline.View
            header={null}
            deferred={() => false}
            renderRow={(row) => (
              <div
                data-component="markdown"
                data-markdown-ready={state.ready ? "" : undefined}
                style={{
                  height: `${input.rowHeight + (state.grown && row().userMessageID === `message-${input.count - 1}` ? 40 : 0)}px`,
                }}
                data-timeline-part-ids={row().userMessageID === "message-0" ? "prt_first,prt_grouped" : undefined}
              >
                {row().userMessageID}
              </div>
            )}
          />
        </div>
      </div>
    )
  }

  render(
    () => (
      <LanguageProvider locale="en">
        <Fixture />
      </LanguageProvider>
    ),
    host,
  )
}

/**
 * Rows the test replaces. `replace(next, settled)` publishes `next` and then, in the same flush and after TanStack has
 * read `next`, `settled`: what a projection does when its inputs settle in two steps. Each mounted row records any
 * other key's row it is handed.
 */
export function mountTimelineRowChanges(ids: string[]) {
  const host = document.createElement("main")
  host.dataset.testid = "timeline-row-changes-fixture"
  host.style.cssText = "position:fixed;top:24px;right:24px;width:400px;z-index:1000"
  document.body.appendChild(host)
  const list = (ids: string[]) => ids.map((id) => new TimelineRow.UserMessage({ userMessageID: id }))
  const [rows, setRows] = createSignal(list(ids))
  const errors: string[] = []
  const foreign: string[] = []
  let settled: string[] | undefined

  function Fixture() {
    const rowByKey = createMemo(() => new Map(rows().map((row) => [TimelineRow.key(row), row])))
    const indexes = createMemo(() => new Map(rows().map((row, index) => [row.userMessageID, index])))

    const timeline = createTimelineVirtualizer({
      sessionKey: () => "row-changes-fixture",
      projection: {
        rows,
        rowByKey,
        activeMessageID: () => undefined,
        messageByID: () => new Map(),
        messageRowIndex: indexes,
        messageLastRowIndex: indexes,
      },
      showHeader: () => false,
      follow: createTimelineFollow(() => "row-changes-fixture"),
      scroll: () => ({ overflow: false, jump: false }),
      setScrollRef: () => {},
      onContentResize: () => {},
      onScheduleScrollState: () => {},
      onResumeScroll: () => {},
      onUserScroll: () => {},
      onHistoryScroll: () => {},
      canRenderImmediately: () => true,
    })

    // Created after the virtualizer, so it runs once TanStack has read the rows it follows.
    createComputed(() => {
      rows()
      const next = settled

      settled = undefined

      if (next) setRows(list(next))
    })

    return (
      <div style={{ height: "400px", width: "400px" }}>
        <timeline.View
          header={null}
          deferred={() => false}
          renderRow={(row) => {
            const key = TimelineRow.key(row())

            const read = () => {
              const other = TimelineRow.key(row())

              if (other !== key) foreign.push(`${key} read ${other}`)
            }

            // Renderers read their row while mounted and again as they unmount, as a row that stops growing in does.
            createComputed(read)
            onCleanup(read)

            return <div style={{ height: "40px" }}>{key}</div>
          }}
        />
      </div>
    )
  }

  render(
    () => (
      <LanguageProvider locale="en">
        <Fixture />
      </LanguageProvider>
    ),
    host,
  )

  return {
    errors,
    foreign,
    mounted: () =>
      [...host.querySelectorAll<HTMLElement>("[data-timeline-key]")].map((element) => element.dataset.timelineKey),
    replace: (next: string[], then?: string[]) => {
      settled = then

      try {
        setRows(list(next))
      } catch (error) {
        errors.push(String(error))
      }
    },
  }
}
