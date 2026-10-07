import { createEffect, on, onCleanup, Show } from "solid-js"
import { useLocation } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { SessionProgressIndicatorV2 } from "@opencode-ai/session-ui/v2/session-progress-indicator-v2"
import { TablerIcon } from "@opencode-ai/ui/tabler-icon"
import type { VoiceRecorder } from "./recorder"
import { createVoiceRecovery } from "./recovery"
import "./input.css"

export function VoiceInput(props: { recorder: VoiceRecorder; disabled?: boolean }) {
  const language = useLanguage()
  const location = useLocation()
  createEffect(on(() => `${location.pathname}${location.search}`, props.recorder.cancel, { defer: true }))
  const state = props.recorder.state
  createVoiceRecovery(props.recorder)
  const time = () => `${Math.floor(state.seconds / 60)}:${String(state.seconds % 60).padStart(2, "0")}`
  const status = () =>
    language.t(
      state.status === "processing"
        ? "voice.transcribing"
        : state.status === "requesting"
          ? "voice.requesting"
          : state.status === "ready"
            ? "voice.ready"
            : "voice.recording",
    )
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !props.recorder.active()) return
    event.preventDefault()
    event.stopPropagation()
    props.recorder.cancel()
  }
  document.addEventListener("keydown", escape, true)
  onCleanup(() => {
    props.recorder.cancel()
    document.removeEventListener("keydown", escape, true)
  })
  createEffect(
    on(
      () => state.pendingRequests,
      (count) => {
        if (!count) return
        showToast({
          title: language.t("voice.process.pending.title"),
          description: language.t("voice.process.pending.description"),
        })
      },
    ),
  )

  createEffect(
    on(
      () => state.processingError,
      (error) => {
        if (error)
          showToast({
            variant: "error",
            title: language.t("voice.model.error.title"),
            description: language.t(`voice.model.error.${error}`),
          })
      },
    ),
  )

  return (
    <div data-component="voice-input" data-state={state.status}>
      <Show
        when={props.recorder.active()}
        fallback={
          <button
            type="button"
            class="voice-button"
            data-action="voice-start"
            disabled={props.disabled}
            aria-label={language.t("voice.start")}
            title={language.t("voice.start")}
            onClick={() => void props.recorder.start()}
          >
            <TablerIcon name="voiceInput" size={20} />
          </button>
        }
      >
        <div class="voice-strip">
          <button
            ref={(button) => queueMicrotask(() => button.focus())}
            type="button"
            class="voice-button"
            data-action="voice-cancel"
            aria-label={language.t("voice.cancel")}
            title={language.t("voice.cancel")}
            onClick={props.recorder.cancel}
          >
            <TablerIcon name="voiceCancel" size={18} />
          </button>
          <span class="voice-status" role="status">
            {status()}
          </span>
          <Show when={state.status === "processing"}>
            <SessionProgressIndicatorV2 class="size-4" />
          </Show>
          <div class="voice-waveform">
            <canvas ref={props.recorder.setCanvas} role="img" aria-label={language.t("voice.volume")} />
          </div>
          <span class="voice-time" role="timer" aria-label={language.t("voice.duration", { time: time() })}>
            {time()}
          </span>
          <Show
            when={state.status === "ready"}
            fallback={
              <button
                type="button"
                class="voice-button voice-stop"
                data-action="voice-stop"
                disabled={state.status !== "recording"}
                aria-label={language.t("voice.stop")}
                title={language.t("voice.stop")}
                onClick={props.recorder.stop}
              >
                <TablerIcon name="voiceStop" size={18} />
              </button>
            }
          >
            <audio
              ref={props.recorder.setAudio}
              src={state.url}
              onPlay={() => props.recorder.setPlaying(true)}
              onPause={() => props.recorder.setPlaying(false)}
              onEnded={() => props.recorder.setPlaying(false)}
            />
            <button
              type="button"
              class="voice-button"
              data-action="voice-play"
              aria-label={language.t(state.playing ? "voice.pause" : "voice.play")}
              title={language.t(state.playing ? "voice.pause" : "voice.play")}
              onClick={props.recorder.togglePlayback}
            >
              <TablerIcon name={state.playing ? "voicePause" : "voicePlay"} size={18} />
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )
}
