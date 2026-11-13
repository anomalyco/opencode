import { Show, createSignal, untrack } from "solid-js"
import { NewSessionBrickBreaker } from "./brick-breaker"
import { NewSessionPinBoard } from "./pin-board"
import { NewSessionWordmark } from "./wordmark"
import {
  createWordmarkState,
  selectBrickBreaker,
  selectPinBoard,
  transitionWordmark,
  type WordmarkEvent,
} from "./wordmark-machine"

const modes = ["flat", "pin board", "brick breaker"] as const

type Args = { mode: (typeof modes)[number]; sound: boolean }

export default {
  title: "App/New Session/Wordmark",
  id: "app-new-session-wordmark",
  component: NewSessionWordmark,
  args: { mode: "flat", sound: true },
  argTypes: { mode: { options: modes } },
  // The lodger and its drop target are set up on mount; changing modes starts a fresh panel.
  render: (args: Args) => (
    <Show when={args.mode} keyed>
      {(mode) => <Panel mode={mode} sound={args.sound} />}
    </Show>
  ),
}

function Panel(props: Args) {
  const [state, setState] = createSignal(createWordmarkState(props.mode === "pin board"))

  const [logo, setLogo] = createSignal<HTMLDivElement>()

  let panel!: HTMLDivElement

  let composer!: HTMLFormElement

  const dispatch = (event: WordmarkEvent) =>
    untrack(() => {
      const next = transitionWordmark(state(), event)
      setState(next.state)

      if (next.effects.some((effect) => effect.type === "focus.composer")) composer.focus()
    })

  return (
    <div
      ref={panel}
      data-component="new-session"
      class="relative isolate h-[640px] w-full overflow-hidden rounded-[10px] bg-v2-background-bg-base"
    >
      <div class="absolute inset-x-0 top-[25%] flex justify-center px-6">
        <div class="w-full max-w-[720px]">
          <NewSessionWordmark
            ref={setLogo}
            state={state}
            onEvent={dispatch}
            play={props.mode === "brick breaker"}
            sound={() => props.sound}
          />
          <div data-slot="new-session-composer" class="mt-8">
            <form
              ref={composer}
              data-component="composer"
              tabIndex={props.mode === "brick breaker" ? -1 : undefined}
              class="h-24 w-full rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
            />
          </div>
          <Show when={props.mode === "brick breaker"}>
            <p data-component="new-session-tip" class="mt-3 text-center text-13-regular text-v2-text-text-muted">
              Pull the lodger out of the final “e”, then drag it from its perch onto the composer. Click to launch;
              Escape to quit.
            </p>
          </Show>
        </div>
      </div>
      <Show when={selectPinBoard(state(), logo())}>
        {(board) => (
          <NewSessionPinBoard
            logo={board().logo}
            sound={() => props.sound}
            entrance={board().entrance}
            closing={board().closing}
            ref={(handle) => dispatch({ type: "board.mounted", board: handle })}
          />
        )}
      </Show>
      <Show when={selectBrickBreaker(state())}>
        {(game) => (
          <NewSessionBrickBreaker
            panel={panel}
            board={game().board}
            ball={game().ball}
            sound={() => props.sound}
            onDone={() => dispatch({ type: "game.done" })}
          />
        )}
      </Show>
    </div>
  )
}

export const Flat = {}

export const PinBoard = { args: { mode: "pin board" } }

export const BrickBreaker = { args: { mode: "brick breaker" } }
