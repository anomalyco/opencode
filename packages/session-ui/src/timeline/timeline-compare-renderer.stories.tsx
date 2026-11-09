import { Show, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { SessionDocument } from "../document"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import type { TimelineDetail } from "./detail"
import { SessionTimeline } from "./session-timeline"

// The compare tool copies this story into an older checkout to render the same session there, so it may only use what
// every build it compares has: the session document, the detail setting, and the timeline component itself.
export default {
  title: "OpenCode/Timeline/Compare renderer",
  id: "timeline-compare-renderer",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

type Render = {
  type: "timeline-compare:render"
  document: SessionDocument
  detail: TimelineDetail
  activity: boolean
  turnDiffs: boolean
  width: number
  /** What the line below a working turn says, as the build comparing it shows it. */
  status?: string
}

type ScrollTo = { type: "timeline-compare:scroll-to"; anchor: string; offset: number }

export const Renderer = {
  render: () => {
    const [state, setState] = createStore<{ render?: Render }>({})
    let scroller: HTMLDivElement | undefined
    // A scroll this frame made to follow the other side is not reported back, so the two never chase each other.
    let following = 0

    const receive = (event: MessageEvent<Render | ScrollTo>) => {
      if (event.data?.type === "timeline-compare:render") return setState("render", reconcile(event.data))

      if (event.data?.type !== "timeline-compare:scroll-to" || !scroller) return
      const target = scroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(event.data.anchor)}"]`)

      if (!target) return
      following = performance.now()
      scroller.scrollTop +=
        target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - event.data.offset
    }

    // The topmost turn on screen and how far it sits from the top, which the other side lines up with.
    const report = () => {
      if (!scroller || performance.now() - following < 120) return
      const top = scroller.getBoundingClientRect().top

      const anchor = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].find(
        (element) => element.getBoundingClientRect().bottom > top,
      )

      if (!anchor?.dataset.messageId) return
      window.parent.postMessage(
        {
          type: "timeline-compare:scroll",
          anchor: anchor.dataset.messageId,
          offset: anchor.getBoundingClientRect().top - top,
        },
        "*",
      )
    }

    onMount(() => {
      window.addEventListener("message", receive)
      window.parent.postMessage({ type: "timeline-compare:ready" }, "*")
    })
    onCleanup(() => window.removeEventListener("message", receive))

    return (
      <div
        ref={scroller}
        class="h-screen overflow-y-auto bg-v2-background-bg-base text-v2-text-text-base"
        data-scrollable
        onScroll={report}
      >
        <Show when={state.render}>
          {(render) => (
            <div class="mx-auto py-6" style={{ "max-width": `${render().width}px` }}>
              <CurrentSessionProviders document={render().document}>
                <SessionTimeline
                  document={render().document}
                  timelineDetail={render().detail}
                  activity={render().activity}
                  turnDiffs={render().turnDiffs}
                />
              </CurrentSessionProviders>
              <Show when={render().status}>
                {(status) => (
                  <div class="px-6 pt-3 text-13-medium text-v2-text-text-muted" role="status">
                    {status()}
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
      </div>
    )
  },
}
