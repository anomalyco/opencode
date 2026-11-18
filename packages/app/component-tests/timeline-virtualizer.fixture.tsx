import type { SessionMessageInfo, SessionStatus } from "@opencode/client/promise"
import { CurrentSessionProviders } from "@opencode/session-ui/storybook"
import { createNextTimelineProjection, createNextTimelineRowRenderer } from "@opencode/session-ui/timeline-next"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { TimelineRow } from "@opencode/session-ui/timeline/projection"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { Predicate } from "effect"
import { batch, createMemo, onCleanup, Show } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider, UiI18nBridge } from "../src/runtime/i18n/language"
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

const assistant = (
  id: string,
  time: { created: number; completed?: number },
  content: Extract<SessionMessageInfo, { type: "assistant" }>["content"],
) => ({ id, type: "assistant", agent: "build", model: { id: "model", providerID: "provider" }, time, content }) as const

const history: SessionMessageInfo[] = [
  { id: "msg_user_1", type: "user", text: "Plan it first", time: { created: 1 } },
  assistant("msg_assistant_1", { created: 2, completed: 2 }, [{ type: "text", text: "Here is the plan." }]),
  { id: "msg_idle_1", type: "idle", outcome: "succeeded", time: { created: 3 } },
  { id: "msg_user_2", type: "user", text: "Now build it", time: { created: 4 } },
  assistant("msg_assistant_2", { created: 5, completed: 5 }, [{ type: "text", text: "Built it." }]),
  { id: "msg_idle_2", type: "idle", outcome: "succeeded", time: { created: 6 } },
]

/**
 * The New timeline under the real virtualizer, drawn by its real row renderer the way message-timeline.tsx draws it.
 * Each event edits the transcript the way the client applies it, and keeps any error the renderer threw.
 */
export function mountNextTimelineVirtualizer(preset: (typeof timelinePresets)[number]["id"]) {
  const detail = timelinePresets.find((item) => item.id === preset)!.value
  const host = document.createElement("main")
  host.dataset.testid = "next-timeline-virtualizer-fixture"
  host.style.cssText = "position:fixed;top:24px;right:24px;width:640px;z-index:1000"
  document.body.appendChild(host)
  const errors: string[] = []

  const [state, setState] = createStore<{ messages: SessionMessageInfo[]; status: SessionStatus; pending: string[] }>({
    messages: [],
    status: { type: "idle" },
    pending: [],
  })

  let container!: HTMLDivElement

  const session = {
    sessionID: "ses_fixture",
    get messages() {
      return state.messages
    },
    get status() {
      return state.status
    },
    diffs: [],
  }

  function Fixture() {
    const follow = createTimelineFollow(() => "next-timeline-virtualizer-fixture")

    const pendingInputIDs = createMemo(() => new Set(state.pending))

    const projection = createNextTimelineProjection({
      sessionMessages: () => state.messages,
      status: () => state.status,
      timelineDetail: () => detail,
      pendingInputIDs,
    })

    const timeline = createTimelineVirtualizer({
      sessionKey: () => "next-timeline-virtualizer-fixture",
      projection,
      showHeader: () => false,
      follow,
      scroll: () => ({ overflow: false, jump: false }),
      setScrollRef: () => {},
      onContentResize: () => {},
      onScheduleScrollState: () => {},
      onResumeScroll: () => {},
      onUserScroll: () => {},
      onHistoryScroll: () => {},
    })

    const rowRenderer = createNextTimelineRowRenderer({
      sessionID: () => session.sessionID,
      status: () => state.status,
      projection,
      presentation: () => undefined,
      timelineDetail: () => detail,
      disclosure: timeline.disclosure,
    })

    return (
      <div ref={container} style={{ height: "320px", width: "640px" }}>
        <timeline.View
          header={null}
          deferred={() => false}
          renderRow={(row, onSizeChange) => (
            <Show
              when={Predicate.isTagged(row(), "Activity")}
              fallback={<rowRenderer.Row row={row} onSizeChange={onSizeChange} />}
            >
              <div style={{ height: "36px" }} />
            </Show>
          )}
        />
      </div>
    )
  }

  render(
    () => (
      <LanguageProvider locale="en">
        <UiI18nBridge>
          <DialogProvider>
            <CurrentSessionProviders document={session}>
              <Fixture />
            </CurrentSessionProviders>
          </DialogProvider>
        </UiI18nBridge>
      </LanguageProvider>
    ),
    host,
  )

  const apply = (change: () => void) => {
    try {
      change()
    } catch (error) {
      errors.push(String(error))
    }
  }

  const edit = (change: (messages: SessionMessageInfo[]) => void) => apply(() => setState("messages", produce(change)))

  return {
    errors,
    // The transcript arrives as a message sync, which reconciles it with what the server has.
    "history.loaded": () => apply(() => setState("messages", reconcile(structuredClone(history)))),
    prompt: () =>
      apply(() =>
        setState({
          messages: [...state.messages, { id: "msg_user_3", type: "user", text: "Now test it", time: { created: 7 } }],
          status: { type: "busy" },
        }),
      ),
    "step.started": () => edit((messages) => messages.push(assistant("msg_assistant_3", { created: 8 }, []))),
    "reasoning.started": () =>
      edit((messages) => {
        const message = messages.at(-1)

        if (message?.type === "assistant") message.content.push({ type: "reasoning", text: "", time: { created: 8 } })
      }),
    // Some providers stream thinking with no readable text, so the thought ends as empty as it started.
    "reasoning.ended": () =>
      edit((messages) => {
        const message = messages.at(-1)
        const content = message?.type === "assistant" ? message.content.at(-1) : undefined

        if (content?.type === "reasoning") content.time = { created: 8, completed: 9 }
      }),
    // A whole transcript at once, as a message sync or a history page reconciles it.
    sync: (next: { messages: SessionMessageInfo[]; status: SessionStatus; pending: string[] }) =>
      apply(() =>
        batch(() => {
          setState("messages", reconcile(structuredClone(next.messages)))
          setState("status", reconcile(next.status))
          setState("pending", reconcile(next.pending))
        }),
      ),
    viewport: () => host.querySelector<HTMLElement>("[data-scrollable]")!,
    resize: (height: number) => (container.style.height = `${height}px`),
  }
}
