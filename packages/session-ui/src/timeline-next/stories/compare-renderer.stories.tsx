import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { BackgroundMoveHint } from "../../../../app/src/session/timeline/message-timeline"
import { createStore, reconcile } from "solid-js/store"
import type { SessionDocument } from "../../document"
import { CurrentSessionProviders } from "../../storybook/current-session-story"
import type { TimelineDetail } from "../../timeline/detail"
import { SessionTimeline } from "../../timeline/session-timeline"
import { StatusLane } from "../status-line"
import { NextSessionTimeline } from "./session-timeline"

// One side of the compare page: the session as this build draws it, the New timeline when `activity` is set. Other
// builds, such as timeline-policy, answer the same messages, so the page can compare them.
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
  /** The New timeline's lane, which folds away while a thought takes its place, or the lane the app has today. */
  lane: "activity" | "legacy"
  collapsed?: boolean
  spacing?: "s" | "l"
  /** A shell or subagent call blocks the turn, so the lane offers to move it to the background. */
  hint?: boolean
  /** How long the call runs before that offer shows, as the build comparing it waits. */
  hintDelay?: number
}

const padding = "px-4 md:px-6"

type ScrollTo = { type: "timeline-compare:scroll-to"; anchor: string; offset: number }

export const Renderer = {
  render: () => {
    const [state, setState] = createStore<{ render?: Render }>({})
    const [hint, setHint] = createSignal(false)

    // The offer shows once the call has blocked the turn for the build's delay, counted from when the playhead got here.
    createEffect(() => {
      const render = state.render

      if (!render?.hint) return setHint(false)
      const timer = setTimeout(() => setHint(true), render.hintDelay ?? 0)
      onCleanup(() => clearTimeout(timer))
    })

    const move = () => (
      <Show when={hint()}>
        <div data-component="session-background-hint-row">
          <BackgroundMoveHint keybind={["Ctrl", "B"]} />
        </div>
      </Show>
    )

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
                <Show
                  when={render().activity}
                  fallback={
                    <SessionTimeline
                      document={render().document}
                      timelineDetail={render().detail}
                      turnDiffs={render().turnDiffs}
                    />
                  }
                >
                  <NextSessionTimeline
                    document={render().document}
                    timelineDetail={render().detail}
                    turnDiffs={render().turnDiffs}
                  />
                </Show>
              </CurrentSessionProviders>
              <Show
                when={render().lane === "activity"}
                fallback={
                  <div
                    class={`flex h-9 items-center gap-2 pt-3 text-[13px] font-[530] leading-text-compact ${padding}`}
                  >
                    <Show when={render().status}>
                      {(status) => (
                        <div data-component="session-working" role="status">
                          <TextShimmer text={status()} active />
                        </div>
                      )}
                    </Show>
                    {move()}
                  </div>
                }
              >
                <StatusLane
                  class={padding}
                  label={render().status}
                  collapsed={render().collapsed && !hint()}
                  spacing={render().spacing}
                >
                  {move()}
                </StatusLane>
              </Show>
            </div>
          )}
        </Show>
      </div>
    )
  },
}
