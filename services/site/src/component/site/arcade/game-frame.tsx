import "./game-frame.css"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { gameUrl, publicGameUrl, type Game } from "./games"
import { PixelText } from "./pixel-text"

/**
 * One Anomaly Arcade game, live in a frame that fills its container: a loading screen until it
 * arrives, "Click to play" until it has keyboard focus (not on touch screens), and a message with
 * a link to anoma.ly when the browser lacks WebGPU (`gpu` false). `gpu` undefined means "checking".
 */
export function GameFrame(props: {
  game: Game
  gpu?: boolean
  touch: boolean
  onFrame?: (frame: HTMLIFrameElement | undefined) => void
}) {
  const [loaded, setLoaded] = createSignal(false)
  const [focused, setFocused] = createSignal(false)
  let frame: HTMLIFrameElement | undefined

  // The parent window blurs when the frame takes focus, and focuses again when it loses it.
  onMount(() => {
    const blur = () => setTimeout(() => setFocused(!!frame && document.activeElement === frame), 0)
    const focus = () => setFocused(false)
    window.addEventListener("blur", blur)
    window.addEventListener("focus", focus)
    onCleanup(() => {
      window.removeEventListener("blur", blur)
      window.removeEventListener("focus", focus)
    })
  })

  return (
    <div data-component="arcade-game-frame">
      <Show
        when={props.gpu !== false}
        fallback={
          <div data-slot="message">
            <PixelText text="Needs WebGPU" class="arcade-frame-title" />
            <p>
              {props.game.name} runs on WebGPU, which this browser doesn’t support.{" "}
              <a href={publicGameUrl(props.game.id)} target="_blank" rel="noopener">
                Open {props.game.name} on anoma.ly
              </a>
            </p>
          </div>
        }
      >
        <Show when={props.gpu}>
          <iframe
            ref={(element) => {
              frame = element
              props.onFrame?.(element)
              onCleanup(() => props.onFrame?.(undefined))
            }}
            src={gameUrl(props.game)}
            title={`${props.game.name}, from Anomaly Arcade`}
            allow="gamepad; fullscreen; autoplay"
            onLoad={() => setLoaded(true)}
          />
        </Show>
        <Show when={!loaded()}>
          <div data-slot="loading" aria-hidden="true">
            <PixelText text="Loading" class="arcade-frame-title arcade-frame-blink" />
          </div>
        </Show>
        <Show when={loaded() && !focused() && !props.touch}>
          <button
            type="button"
            data-slot="focus"
            onClick={() => {
              frame?.focus()
              setFocused(true)
            }}
          >
            <PixelText text="Click to play" class="arcade-frame-title arcade-frame-blink" />
            <span>{props.game.hint}</span>
          </button>
        </Show>
      </Show>
    </div>
  )
}
