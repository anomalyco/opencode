import { motionTuning } from "@opencode/ui/motion-tuning"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { Schema } from "effect"
import { createEffect, For, onCleanup, onMount, Show, untrack, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode/client/promise"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import en from "@/runtime/i18n/en"
import { useVoice } from "./context"
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

    if (session && voice.state.server === server.key) voice.view(server.key, session)
  })

  return (
    <>
      {props.children}
      <Show when={enabled() && props.session && voice.state.status === "idle"}>
        <div class="voice-call-action">
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              const session = props.session

              if (session) void voice.start(server.key, server.ctx, session)
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
    <Show when={voice.state.status !== "idle"}>
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

  // How far the panel can move while staying inside the window, read once per drag rather than every frame.
  const bounds = () => {
    const rect = panel.getBoundingClientRect()

    return {
      x: [position.x - rect.left, position.x + window.innerWidth - rect.right],
      y: [position.y - rect.top, position.y + window.innerHeight - rect.bottom],
    }
  }

  const clamp = (limits: ReturnType<typeof bounds>, x: number, y: number) => ({
    x: Math.min(Math.max(x, limits.x[0]), Math.max(limits.x[0], limits.x[1])),
    y: Math.min(Math.max(y, limits.y[0]), Math.max(limits.y[0], limits.y[1])),
  })

  // Before stored state loads, a write would mark the store edited and drop the saved position.
  const settle = () => {
    if (!ready()) return
    const next = clamp(bounds(), position.x, position.y)

    if (next.x !== position.x || next.y !== position.y) setPosition(next)
  }

  const grab = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      event.target.closest("button") ||
      onScrollbar(event)
    )
      return
    event.preventDefault()
    const limits = bounds()
    const start = { x: event.clientX - position.x, y: event.clientY - position.y }
    panel.setPointerCapture(event.pointerId)

    const move = (moved: PointerEvent) => setPosition(clamp(limits, moved.clientX - start.x, moved.clientY - start.y))

    const drop = () => {
      panel.removeEventListener("pointermove", move)
      panel.removeEventListener("pointerup", drop)
      panel.removeEventListener("pointercancel", drop)
      panel.removeEventListener("lostpointercapture", drop)
    }

    panel.addEventListener("pointermove", move)
    panel.addEventListener("pointerup", drop)
    panel.addEventListener("pointercancel", drop)
    panel.addEventListener("lostpointercapture", drop)
  }

  onMount(() => {
    const observer = new ResizeObserver(settle)
    observer.observe(panel)
    window.addEventListener("resize", settle)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", settle)
    })
  })

  // A saved position from a larger window is pulled back on screen once storage has loaded.
  createEffect(() => {
    if (ready()) untrack(settle)
  })

  const speaker = (value: "user" | "assistant") => language.t(value === "user" ? "voice.you" : "voice.assistant")

  return (
    <section
      ref={panel}
      class="voice-panel"
      aria-label={language.t("voice.panel")}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onPointerDown={grab}
      // Pointer presses never move focus, so typing in the composer carries on while the call is controlled.
      onMouseDown={(event) => {
        if (!onScrollbar(event)) event.preventDefault()
      }}
    >
      <div class="voice-controls">
        <meter class="voice-level" min={0} max={1} value={voice.state.level} aria-label={language.t("voice.level")} />
        <span class="voice-title">{voice.state.title}</span>
        <Show when={voice.state.status === "dropped"}>
          <Button size="small" variant="outline" onClick={() => void voice.rejoin()}>
            {language.t("voice.rejoin")}
          </Button>
        </Show>
        <Button
          size="small"
          variant="ghost"
          disabled={voice.state.status !== "connected"}
          aria-pressed={voice.state.muted}
          onClick={voice.mute}
        >
          {language.t(voice.state.muted ? "voice.unmute" : "voice.mute")}
        </Button>
        <Button size="small" variant="ghost" onClick={() => void voice.end()}>
          {language.t("voice.end")}
        </Button>
        <IconButton
          type="button"
          size="small"
          variant="ghost-muted"
          icon={<Icon name={position.expanded ? "chevron-down" : "chevron-up"} />}
          aria-expanded={position.expanded}
          aria-label={language.t(position.expanded ? "voice.captions.hide" : "voice.captions.show")}
          onClick={() => setPosition("expanded", !position.expanded)}
        />
      </div>
      <Show when={voice.state.status === "connecting"}>
        <p class="voice-status" role="status">
          <Loader class="size-3.5 shrink-0" />
          {language.t("voice.connecting")}
        </p>
      </Show>
      <Show when={voice.state.status === "dropped"}>
        <p class="voice-status" role="alert">
          {language.t(`voice.failure.${voice.state.failure ?? "dropped"}`)}
        </p>
      </Show>
      <Show
        when={position.expanded}
        fallback={
          <Show when={voice.state.caption}>
            <p class="voice-caption voice-latest">
              <span>{speaker(voice.state.speaker)}</span> {voice.state.caption}
            </p>
          </Show>
        }
      >
        <div class="voice-captions" data-scrollable>
          <For each={voice.state.captions}>
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
