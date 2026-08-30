import { TimelineRow } from "@opencode-ai/session-ui/timeline/projection"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider } from "../src/runtime/i18n/language"
import { createTimelineVirtualizer } from "../src/session/timeline/virtualizer"

export function mountTimelineVirtualizer(input: { count: number; rowHeight: number; immediate?: boolean }) {
  const host = document.createElement("main")
  host.dataset.testid = "timeline-virtualizer-fixture"
  host.dataset.scrolls = "0"
  host.dataset.viewportResizes = "0"
  host.style.cssText = "position:fixed;top:24px;right:24px;width:400px;z-index:1000"
  document.body.appendChild(host)

  function Fixture() {
    const [state, setState] = createStore({ pinned: true, ready: false })
    const rows = Array.from(
      { length: input.count },
      (_, index) => new TimelineRow.UserMessage({ userMessageID: `message-${index}` }),
    )
    const rowByKey = new Map(rows.map((row) => [TimelineRow.key(row), row]))
    const indexes = new Map(rows.map((row, index) => [row.userMessageID, index]))
    let viewport!: HTMLDivElement
    let content!: HTMLDivElement
    let container!: HTMLDivElement
    const timeline = createTimelineVirtualizer({
      sessionKey: () => "cold-reveal-fixture",
      projection: {
        rows: () => rows,
        rowByKey: () => rowByKey,
        activeMessageID: () => undefined,
        messageRowIndex: () => indexes,
        messageLastRowIndex: () => indexes,
      },
      showHeader: () => false,
      pinned: () => state.pinned,
      scroll: () => ({ overflow: false, jump: false }),
      setScrollRef: (element) => {
        if (!element) return
        viewport = element
        resize.observe(element, { box: "border-box" })
      },
      setContentRef: (element) => {
        content = element
        reveal.observe(element, { attributes: true, attributeFilter: ["style"] })
      },
      onPin: () => setState("pinned", true),
      onUnpin: () => setState("pinned", false),
      onScheduleScrollState: (element) => {
        host.dataset.scrolls = String(Number(host.dataset.scrolls) + 1)
        host.dataset.lastScrollTop = String(element.scrollTop)
      },
      onResumeScroll: () => {},
      onSelectionInteraction: () => {},
      onUserScroll: () => {},
      onHistoryScroll: () => {},
      canRenderImmediately: () => input.immediate ?? false,
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
        clipped: mounted
          .filter((element) => element.firstElementChild!.getBoundingClientRect().height > element.offsetHeight + 1)
          .map((element) => element.dataset.timelineKey),
      })
    })
    onCleanup(() => {
      resize.disconnect()
      reveal.disconnect()
    })

    return (
      <div data-testid="timeline-controls" data-pinned={state.pinned}>
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
        <div ref={container} style={{ height: "180px", width: "400px" }}>
          <timeline.View
            header={null}
            workspaceSession={() => false}
            deferred={() => false}
            renderRow={(row) => (
              <div
                data-component="markdown"
                data-markdown-ready={state.ready ? "" : undefined}
                style={{ height: `${input.rowHeight}px` }}
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
