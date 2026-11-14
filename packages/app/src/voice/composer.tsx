import { motionTuning } from "@opencode/ui/motion-tuning"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { Schema } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode/client/promise"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import en from "@/runtime/i18n/en"
import { useVoice } from "./context"
import {
  canGrabVoicePanel,
  canToggleVoiceCaptions,
  fillVoicePanelBounds,
  HYDRATING_VOICE_PANEL_STATE,
  transitionVoicePanel,
  voicePanelOffset,
  voicePanelTransform,
  type MutablePanelBounds,
  type VoicePanelEvent,
} from "./panel-machine"
import "./voice.css"

const toggle = motionTuning.toggle("voice.calls", {
  label: en["experiment.voiceCalls"],
  group: "Voice",
  description: "Call button in the composer",
  target: ".voice-call-action",
  experiment: true,
  value: false,
})

// Where the panel was dragged to, as an offset from its bottom-right home.
const PanelState = Persistence.struct({
  x: Schema.Number,
  y: Schema.Number,
  expanded: Schema.Boolean,
})

export function VoiceComposer(props: ParentProps<{ session: SessionInfo | undefined }>) {
  const voice = useVoice()
  const server = useServer()
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({ enabled: toggle() })
  onCleanup(motionTuning.subscribe(() => setState("enabled", toggle())))

  const enabled = () =>
    platform.platform === "desktop" && import.meta.env.VITE_OPENCODE_CHANNEL !== "prod" && state.enabled

  createEffect(() => {
    const session = props.session

    if (session) voice.syncSession(server.key, session)
  })

  return (
    <>
      {props.children}
      <Show when={enabled() && props.session && voice.view().canStart}>
        <div class="voice-call-action">
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              const session = props.session

              if (session) voice.start(server.key, server.ctx, session)
            }}
          >
            {language.t("voice.call")}
          </Button>
        </div>
      </Show>
    </>
  )
}

/** The call's floating panel. It sits beside the composer, never replaces it, and can be dragged anywhere. */
export function VoiceOverlay() {
  const voice = useVoice()

  return (
    <Show when={voice.view().panelOpen}>
      <VoicePanel />
    </Show>
  )
}

function VoicePanel() {
  const voice = useVoice()
  const language = useLanguage()
  let panel!: HTMLElement

  const [position, setPosition, , ready] = persisted(Persist.global("voice.panel"), PanelState, {
    x: 0,
    y: 0,
    expanded: false,
  })

  // A signal, not a store: a drag moves the dragging state in place.
  const [panelState, setPanelState] = createSignal(HYDRATING_VOICE_PANEL_STATE)
  // Reused by every move and resize, so a drag allocates nothing.
  const move = { type: "pointer.move" as const, pointerId: 0, clientX: 0, clientY: 0 }
  const resize = { type: "resize" as const, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } }

  // Measured against the offset painted now, so a saved position that has not painted yet cannot skew it.
  const bounds = (out: MutablePanelBounds) =>
    fillVoicePanelBounds(
      out,
      panel.getBoundingClientRect(),
      voicePanelOffset(untrack(panelState)),
      window.innerWidth,
      window.innerHeight,
    )

  const dispatch = (event: VoicePanelEvent) => {
    const prev = untrack(panelState)
    const prevX = voicePanelOffset(prev).x
    const prevY = voicePanelOffset(prev).y
    const next = transitionVoicePanel(prev, event)

    if (next === prev) {
      if (next.status === "dragging" && (next.x !== prevX || next.y !== prevY))
        panel.style.transform = voicePanelTransform(next)

      return
    }

    if (prev.status === "dragging" && panel.hasPointerCapture(prev.pointerId))
      panel.releasePointerCapture(prev.pointerId)

    if (next.status === "dragging") panel.setPointerCapture(next.pointerId)
    // Saved when a load, resize or drag settles it, and when the panel closes mid-drag; never before it loaded.
    const settled = next.status === "idle" ? next : prev.status === "dragging" ? prev : undefined

    if (settled && settled.x !== position.x) setPosition("x", settled.x)

    if (settled && settled.y !== position.y) setPosition("y", settled.y)
    setPanelState(next)
  }

  const onResize = () => {
    bounds(resize.bounds)
    dispatch(resize)
  }

  onMount(() => {
    const observer = new ResizeObserver(onResize)
    observer.observe(panel)
    window.addEventListener("resize", onResize)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", onResize)
    })
  })
  makeEventListener(window, "blur", () => dispatch({ type: "blur" }))
  // Registered after `persisted`, so it runs before its cleanup and an unmount mid-drag still saves the position.
  onCleanup(() => dispatch({ type: "disposed" }))

  // A saved position from a larger window is pulled back on screen once storage has loaded.
  createEffect(() => {
    if (ready())
      untrack(() =>
        dispatch({
          type: "hydrated",
          x: position.x,
          y: position.y,
          bounds: bounds({ minX: 0, maxX: 0, minY: 0, maxY: 0 }),
        }),
      )
  })

  const speaker = (value: "user" | "assistant") => language.t(value === "user" ? "voice.you" : "voice.assistant")

  return (
    <section
      ref={panel}
      class="voice-panel"
      aria-label={language.t("voice.panel")}
      style={{ transform: voicePanelTransform(panelState()) }}
      onPointerDown={(event) => {
        if (
          !canGrabVoicePanel(panelState()) ||
          event.button !== 0 ||
          !(event.target instanceof Element) ||
          event.target.closest("button") ||
          onScrollbar(event)
        )
          return
        event.preventDefault()
        dispatch({
          type: "pointer.down",
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          bounds: bounds({ minX: 0, maxX: 0, minY: 0, maxY: 0 }),
        })
      }}
      onPointerMove={(event) => {
        move.pointerId = event.pointerId
        move.clientX = event.clientX
        move.clientY = event.clientY
        dispatch(move)
      }}
      onPointerUp={(event) => dispatch({ type: "pointer.up", pointerId: event.pointerId })}
      onPointerCancel={(event) => dispatch({ type: "pointer.up", pointerId: event.pointerId })}
      onLostPointerCapture={(event) => dispatch({ type: "pointer.up", pointerId: event.pointerId })}
      // Pointer presses never move focus, so typing in the composer carries on while the call is controlled.
      onMouseDown={(event) => {
        if (!onScrollbar(event)) event.preventDefault()
      }}
    >
      <div class="voice-controls">
        <meter class="voice-level" min={0} max={1} value={voice.view().level} aria-label={language.t("voice.level")} />
        <span class="voice-title">{voice.view().title}</span>
        <Show when={voice.view().canRejoin}>
          <Button size="small" variant="outline" onClick={voice.rejoin}>
            {language.t("voice.rejoin")}
          </Button>
        </Show>
        <Button
          size="small"
          variant="ghost"
          disabled={!voice.view().canMute}
          aria-pressed={voice.view().muted}
          onClick={voice.mute}
        >
          {language.t(voice.view().muted ? "voice.unmute" : "voice.mute")}
        </Button>
        <Button size="small" variant="ghost" onClick={voice.end}>
          {language.t("voice.end")}
        </Button>
        <IconButton
          type="button"
          size="small"
          variant="ghost-muted"
          icon={<Icon name={position.expanded ? "chevron-down" : "chevron-up"} />}
          aria-expanded={position.expanded}
          aria-label={language.t(position.expanded ? "voice.captions.hide" : "voice.captions.show")}
          disabled={!canToggleVoiceCaptions(panelState())}
          onClick={() => setPosition("expanded", !position.expanded)}
        />
      </div>
      <Show when={voice.view().connecting}>
        <p class="voice-status" role="status">
          <Loader class="size-3.5 shrink-0" />
          {language.t("voice.connecting")}
        </p>
      </Show>
      <Show when={voice.view().failure}>
        {(failure) => (
          <p class="voice-status" role="alert">
            {language.t(`voice.failure.${failure()}`)}
          </p>
        )}
      </Show>
      <Show
        when={position.expanded}
        fallback={
          <Show when={voice.view().latestCaption}>
            {(latest) => (
              <p class="voice-caption voice-latest">
                <span>{speaker(latest().speaker)}</span> {latest().text}
              </p>
            )}
          </Show>
        }
      >
        <div class="voice-captions" data-scrollable>
          <For each={voice.view().captions}>
            {(caption) => (
              <p class="voice-caption">
                <span>{speaker(caption.speaker)}</span> {caption.text}
              </p>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

// A press on a scroll container's own scrollbar lands outside its client box; it scrolls rather than drags.
function onScrollbar(event: MouseEvent) {
  const target = event.target

  return (
    target instanceof HTMLElement &&
    target.hasAttribute("data-scrollable") &&
    (event.offsetX >= target.clientWidth || event.offsetY >= target.clientHeight)
  )
}
