import { Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { ComposerDropzone } from "../src/composer/dropzone"
import { createAnimatedPresence } from "../src/runtime/animated-presence"
import { LanguageProvider } from "../src/runtime/i18n/language"

type Lane = "bottom" | "row" | "none"

const [state, setState] = createStore<{ hint?: string; lane: Lane; active: boolean }>({ lane: "bottom", active: false })

const host = document.createElement("div")

/**
 * The background hint wired as `MessageTimeline` wires it: two lanes share one ref, and `lane: "none"` unmounts both
 * while the ref still holds the removed element. Beside it, a real `ComposerDropzone`.
 */
export function mountPresence() {
  host.dataset.testid = "presence-fixture"
  document.body.appendChild(host)
  render(() => {
    const [ref, setRef] = createSignal<HTMLDivElement>()

    const presence = createAnimatedPresence(
      () => state.hint,
      () => ref() ?? null,
      () => "ses_fixture",
    )

    const hint = (lane: Lane) => (
      <Show when={state.lane === lane && presence.present()}>
        <div
          ref={setRef}
          data-testid={`hint-${lane}`}
          class="duration-150 motion-reduce:animate-none"
          classList={{
            "animate-in fade-in": presence.animate() && presence.show(),
            "animate-out fade-out fill-mode-forwards": presence.animate() && !presence.show(),
          }}
        >
          {presence.value()}
        </div>
      </Show>
    )

    return (
      <LanguageProvider locale="en">
        <output data-testid="presence-state">{presence.state()}</output>
        {hint("bottom")}
        {hint("row")}
        <div style={{ position: "relative", width: "480px", height: "240px" }}>
          <ComposerDropzone active={state.active} />
        </div>
      </LanguageProvider>
    )
  }, host)
}

export const setPresence = (patch: { hint?: string; lane?: Lane; active?: boolean }) => setState(patch)
