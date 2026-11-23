import { useI18n } from "~/context/i18n"
import "./panel.css"
import { createSignal, For, onCleanup, Show } from "solid-js"
import { sendKey, sendMouse, type ButtonAction, type Game } from "./games"

const stick = {
  up: { code: "KeyW", key: "w" },
  down: { code: "KeyS", key: "s" },
  left: { code: "KeyA", key: "a" },
  right: { code: "KeyD", key: "d" },
} as const
type Direction = keyof typeof stick

/**
 * The cabinet's control panel for touch screens: a ball-top joystick (8-way, sent as WASD) and six
 * buttons lit per game, plus Start and Pause. In development it drives the same-origin game frame
 * with synthetic events; see `gameUrl` for the production bridge this needs.
 */
export function ArcadePanel(props: { game: Game; frame?: HTMLIFrameElement; onPause: () => void; onExit: () => void }) {
  const i18n = useI18n()
  const [knob, setKnob] = createSignal({ x: 0, y: 0 })
  const [pressed, setPressed] = createSignal<string>()
  const [blocked, setBlocked] = createSignal(false)
  let held = new Set<Direction>()
  let base: HTMLDivElement | undefined

  const key = (type: "keydown" | "keyup", code: string, value: string) => {
    if (!sendKey(props.frame, type, code, value)) setBlocked(true)
  }

  const steer = (next: Set<Direction>) => {
    for (const direction of held) if (!next.has(direction)) key("keyup", stick[direction].code, stick[direction].key)
    for (const direction of next) if (!held.has(direction)) key("keydown", stick[direction].code, stick[direction].key)
    held = next
  }

  const track = (event: PointerEvent) => {
    if (!base) return
    const box = base.getBoundingClientRect()
    const radius = box.width / 2
    const dx = event.clientX - (box.left + radius)
    const dy = event.clientY - (box.top + radius)
    const length = Math.hypot(dx, dy)
    const limit = radius * 0.55
    const k = length > limit ? limit / length : 1
    setKnob({ x: dx * k, y: dy * k })
    const next = new Set<Direction>()
    // 8-way with a dead zone: a direction counts once the stick leans past 35% of its travel.
    if (length > limit * 0.35) {
      const angle = Math.atan2(dy, dx)
      const sector = Math.round(angle / (Math.PI / 4))
      if ([-3, -2, -1].includes(sector)) next.add("up")
      if ([1, 2, 3].includes(sector)) next.add("down")
      if ([3, 4, -4, -3].includes(sector)) next.add("left")
      if ([-1, 0, 1].includes(sector)) next.add("right")
    }
    steer(next)
  }

  const release = () => {
    setKnob({ x: 0, y: 0 })
    steer(new Set())
  }
  onCleanup(release)

  const press = (action: ButtonAction, down: boolean) => {
    if ("mouse" in action) {
      if (!sendMouse(props.frame, down ? "mousedown" : "mouseup")) setBlocked(true)
      return
    }
    key(down ? "keydown" : "keyup", action.code, action.key)
  }

  return (
    <div data-component="arcade-panel" role="group" aria-label={`${props.game.name} controls`}>
      <div data-slot="system">
        <button
          type="button"
          data-slot="small"
          onPointerDown={() => key("keydown", "Enter", "Enter")}
          onPointerUp={() => key("keyup", "Enter", "Enter")}
        >
          Start
        </button>
        <button type="button" data-slot="small" onClick={props.onPause}>
          Pause
        </button>
        <button type="button" data-slot="small" onClick={props.onExit}>
          Exit
        </button>
      </div>

      <div
        ref={base}
        data-slot="stick"
        aria-label={i18n.t("site.arcade.joystick")}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          track(event)
        }}
        onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && track(event)}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div data-slot="gate" />
        <div data-slot="shaft" style={{ transform: `translate(${knob().x * 0.5}px, ${knob().y * 0.5}px)` }} />
        <div data-slot="ball" style={{ transform: `translate(${knob().x}px, ${knob().y}px)` }} />
      </div>

      <div data-slot="buttons">
        <For each={props.game.buttons}>
          {(action, index) => (
            <div data-slot="cell">
              <button
                type="button"
                data-slot="button"
                data-lit={action ? "" : undefined}
                data-pressed={pressed() === `${index()}` ? "" : undefined}
                disabled={!action}
                aria-label={action?.label ?? "Unused"}
                onPointerDown={(event) => {
                  if (!action) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setPressed(`${index()}`)
                  navigator.vibrate?.(8)
                  press(action, true)
                }}
                onPointerUp={() => {
                  if (!action) return
                  setPressed(undefined)
                  press(action, false)
                }}
                onPointerCancel={() => {
                  if (!action) return
                  setPressed(undefined)
                  press(action, false)
                }}
              />
              <span data-slot="label">{action?.label ?? ""}</span>
            </div>
          )}
        </For>
      </div>

      <Show when={blocked()}>
        <p data-slot="note">{i18n.t("site.arcade.bridge")}</p>
      </Show>
    </div>
  )
}
