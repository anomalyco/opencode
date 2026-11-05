import { Show, createSignal, untrack } from "solid-js"
import { NewSessionPinBoard } from "./pin-board"
import { NewSessionWordmark } from "./wordmark"
import { createWordmarkState, selectPinBoard, transitionWordmark, type WordmarkEvent } from "./wordmark-machine"

export default {
  title: "App/New Session/Wordmark",
  id: "app-new-session-wordmark",
  component: NewSessionWordmark,
}

function Panel(props: { pins: boolean }) {
  const [state, setState] = createSignal(createWordmarkState(props.pins))
  const [logo, setLogo] = createSignal<HTMLDivElement>()
  const dispatch = (event: WordmarkEvent) => untrack(() => setState(transitionWordmark(state(), event).state))

  return (
    <div
      data-component="new-session"
      class="relative isolate h-[640px] w-full overflow-hidden rounded-[10px] bg-v2-background-bg-base"
    >
      <div class="absolute inset-x-0 top-[25%] flex justify-center px-6">
        <div class="w-full max-w-[720px]">
          <NewSessionWordmark ref={setLogo} state={state} onEvent={dispatch} sound={() => true} />
          <form
            data-component="composer"
            class="mt-8 h-24 w-full rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
          />
        </div>
      </div>
      <Show when={selectPinBoard(state(), logo())}>
        {(board) => (
          <NewSessionPinBoard
            logo={board().logo}
            sound={() => true}
            entrance={board().entrance}
            closing={board().closing}
            ref={(handle) => dispatch({ type: "board.mounted", board: handle })}
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
