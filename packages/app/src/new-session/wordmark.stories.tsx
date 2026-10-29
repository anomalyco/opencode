import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { NewSessionPinBoard } from "./pin-board"
import { NewSessionWordmark } from "./wordmark"

export default {
  title: "App/New Session/Wordmark",
  id: "app-new-session-wordmark",
  component: NewSessionWordmark,
}

function Panel(props: { pins: boolean }) {
  const [state, setState] = createStore({
    box: undefined as HTMLDivElement | undefined,
    mode: (props.pins ? "open" : "flat") as "flat" | "open" | "closing",
  })

  return (
    <div
      data-component="new-session"
      class="relative isolate h-[640px] w-full overflow-hidden rounded-[10px] bg-v2-background-bg-base"
    >
      <div class="absolute inset-x-0 top-[25%] flex justify-center px-6">
        <div class="w-full max-w-[720px]">
          <NewSessionWordmark
            ref={(box) => setState("box", box)}
            pins={props.pins}
            sound={() => true}
            onOpen={() => setState("mode", "open")}
            onClose={() => setState("mode", "closing")}
            onFlat={() => setState("mode", "flat")}
          />
          <form
            data-component="composer"
            class="mt-8 h-24 w-full rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
          />
        </div>
      </div>
      <Show when={state.mode !== "flat" && state.box}>
        {(element) => (
          <NewSessionPinBoard
            logo={element()}
            sound={() => true}
            entrance={props.pins ? "sweep" : "chain"}
            closing={state.mode === "closing"}
          />
        )}
      </Show>
    </div>
  )
}

export const Flat = {
  render: () => <Panel pins={false} />,
}

export const PinBoard = {
  render: () => <Panel pins={true} />,
}
