import { onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { NewSessionBrickBreaker } from "./brick-breaker"
import { NewSessionPinBoard, type PinBoardHandle } from "./pin-board"
import { createPinSound } from "./pin-sound"
import { NewSessionWordmark, type Hero, type LodgerBall } from "./wordmark"

/**
 * The new session wordmark and the easter eggs it hides: pull the pin out of the "e" to open the pin board, and drop
 * the lodger on the composer to play brick breaker. The board and the game draw over the whole panel.
 */
export default function WordmarkHero(props: { hero: Hero }) {
  const sound = createPinSound(() => props.hero.sounds)
  const [state, setState] = createStore<{ box?: HTMLDivElement; mode: "flat" | "open"; game: boolean }>({
    mode: "flat",
    game: false,
  })
  // Imperative handles for the brick breaker; they are not reactive state.
  const handles: { board?: PinBoardHandle; ball?: LodgerBall } = {}

  onCleanup(sound.dispose)

  return (
    <>
      <NewSessionWordmark
        ref={(box) => setState("box", box)}
        hero={props.hero}
        sound={sound}
        onOpen={() => setState("mode", "open")}
        onClose={() => handles.board?.close()}
        onFlat={() => setState("mode", "flat")}
        onPlay={(ball) => {
          handles.ball = ball
          setState("game", true)
        }}
      />
      <Portal mount={props.hero.stage}>
        <Show when={state.mode === "open" && state.box}>
          {(logo) => (
            <NewSessionPinBoard
              logo={logo()}
              hero={props.hero}
              sound={sound}
              entrance="chain"
              ref={(board) => (handles.board = board)}
            />
          )}
        </Show>
        <Show
          when={
            state.game &&
            state.box &&
            handles.board &&
            handles.ball && { logo: state.box, board: handles.board, ball: handles.ball }
          }
        >
          {(game) => (
            <NewSessionBrickBreaker
              hero={props.hero}
              logo={game().logo}
              board={game().board}
              ball={game().ball}
              sound={sound}
              onDone={() => {
                setState("game", false)
                props.hero.focus()
              }}
            />
          )}
        </Show>
      </Portal>
    </>
  )
}
