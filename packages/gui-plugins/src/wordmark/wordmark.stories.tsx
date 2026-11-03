import { onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import WordmarkHero from "./hero"
import { NewSessionPinBoard } from "./pin-board"
import { createPinSound } from "./pin-sound"
import { NewSessionWordmark, type Hero } from "./wordmark"
import css from "./wordmark.css?inline"

export default {
  title: "Plugins/Wordmark",
  id: "plugins-wordmark",
  component: WordmarkHero,
}

// The new session panel as the host lays it out: the hero above a composer, with the panel as the stage.
function Panel(props: { pins: boolean }) {
  const [state, setState] = createStore<{ stage?: HTMLDivElement; area?: HTMLDivElement; box?: HTMLFormElement }>({})

  return (
    <div
      ref={(stage) => setState("stage", stage)}
      data-component="new-session"
      class="relative isolate h-[640px] w-full overflow-hidden rounded-[10px] bg-v2-background-bg-base"
    >
      <style>{css}</style>
      <div class="absolute inset-x-0 top-[25%] flex justify-center px-6">
        <div class="w-full max-w-[720px]">
          <Show
            when={state.stage && state.area && state.box && { stage: state.stage, area: state.area, box: state.box }}
          >
            {(parts) => {
              const hero: Hero = {
                stage: parts().stage,
                composer: { area: parts().area, box: parts().box },
                tip: undefined,
                sounds: true,
                focus: () => parts().box.focus(),
              }

              return props.pins ? <OpenBoard hero={hero} /> : <WordmarkHero hero={hero} />
            }}
          </Show>
          <div ref={(area) => setState("area", area)} class="mt-8">
            <form
              ref={(box) => setState("box", box)}
              data-component="composer"
              class="h-24 w-full rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// The board already open, as it is once the pin is pulled.
function OpenBoard(props: { hero: Hero }) {
  const sound = createPinSound(() => props.hero.sounds)
  const [state, setState] = createStore<{ box?: HTMLDivElement }>({})

  onCleanup(sound.dispose)

  return (
    <>
      <NewSessionWordmark ref={(box) => setState("box", box)} hero={props.hero} pins sound={sound} />
      <Portal mount={props.hero.stage}>
        <Show when={state.box}>
          {(logo) => <NewSessionPinBoard logo={logo()} hero={props.hero} sound={sound} entrance="sweep" />}
        </Show>
      </Portal>
    </>
  )
}

export const Flat = {
  render: () => <Panel pins={false} />,
}

export const PinBoard = {
  render: () => <Panel pins={true} />,
}
