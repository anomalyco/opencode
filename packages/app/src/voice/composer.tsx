import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEffect, createSignal, For, onCleanup, Show, type ParentProps } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useVoice } from "./context"
import type { CallState } from "./call"
import { VoiceScope } from "./scope"
import type { VoiceView } from "./view"
import "./voice.css"

/** Whether this server has a call to show, connecting, live or dropped. */
export function useVoiceCallActive() {
  const voice = useVoice()
  const server = useServer()

  return () => voice.state.status !== "idle" && voice.state.server === server.key
}

/**
 * A screen's part in a call on its server, a session's or a new-session draft's: the call follows what's on screen
 * (subagents, sessions waiting on a request and drafts included), and while this screen is up the floating call steps
 * aside.
 */
export function useVoiceScreen(view: () => VoiceView | undefined) {
  const voice = useVoice()
  const server = useServer()
  const active = useVoiceCallActive()

  createEffect(() => {
    const current = view()

    if (current && voice.state.server === server.key) voice.view(server.key, current)
  })

  createEffect(() => {
    if (active()) voice.attach()
  })

  return active
}

/** Opens the call's captions above the composer. */
export function VoiceComposer(props: ParentProps) {
  const voice = useVoice()
  const active = useVoiceCallActive()

  return (
    <>
      <Show when={active() && voice.state.transcript}>
        <VoiceTranscript />
      </Show>
      {props.children}
    </>
  )
}

/**
 * The call's row on its own, for a session screen whose composer is away: a request docked in its place, a
 * subagent, or a missing location.
 */
export function VoiceCallStrip() {
  const voice = useVoice()

  return (
    <div class="voice-call-strip">
      <Show when={voice.state.transcript}>
        <VoiceTranscript />
      </Show>
      <div class="voice-call-strip-row">
        <VoiceCallControls />
      </div>
    </div>
  )
}

/**
 * A live call when no session screen on its server is up (Home, settings, the new-session page, another server): what
 * it's following, the time, Mute and End, and a way back to its session.
 */
export function VoiceCallPill() {
  const voice = useVoice()
  const language = useLanguage()
  const muteLabel = () => language.t(voice.state.muted ? "voice.unmute" : "voice.mute")
  const dropped = () => voice.state.status === "dropped"

  return (
    <Show when={voice.state.status !== "idle" && voice.state.screens === 0}>
      <section class="voice-call-pill" role="group" aria-label={language.t("voice.panel")}>
        <button
          type="button"
          class="voice-call-pill-return"
          aria-label={language.t("voice.return")}
          onClick={() => voice.reopen()}
        >
          <span class="voice-call-pill-scope">
            <VoiceScope meter={voice.meter} status={voice.state.status} muted={voice.state.muted} />
          </span>
          <span class="voice-call-pill-title">
            {dropped() ? language.t(`voice.failure.${voice.state.failure ?? "dropped"}`) : voice.state.title}
          </span>
        </button>
        <span class="voice-call-time" role="status">
          <Show when={voice.state.status === "connecting"}>{language.t("voice.connecting")}</Show>
          <Show when={voice.state.status === "connected" && voice.state.since} keyed>
            {(since) => <Elapsed since={since} />}
          </Show>
        </span>
        <Tooltip placement="top" value={muteLabel()}>
          <IconButton
            type="button"
            size="large"
            variant="ghost"
            class="voice-call-toggle"
            data-muted={voice.state.muted ? "" : undefined}
            disabled={voice.state.status !== "connected"}
            aria-pressed={voice.state.muted}
            aria-label={muteLabel()}
            icon={<Icon name={voice.state.muted ? "microphone-off" : "microphone"} />}
            onClick={voice.mute}
          />
        </Tooltip>
        <Tooltip placement="top" value={language.t(dropped() ? "voice.close" : "voice.end")}>
          <IconButton
            type="button"
            size="large"
            variant="ghost"
            class="voice-call-end"
            data-dropped={dropped() ? "" : undefined}
            aria-label={language.t(dropped() ? "voice.close" : "voice.end")}
            icon={<Icon name={dropped() ? "close" : "phone-hangup"} />}
            onClick={() => void voice.end()}
          />
        </Tooltip>
      </section>
    </Show>
  )
}

/**
 * The composer's call button, beside Send. Without a view (a draft with no project yet), `onUnavailable` runs instead,
 * such as opening the project picker.
 */
export function VoiceCallButton(props: { view: VoiceView | undefined; onUnavailable?: () => void }) {
  const voice = useVoice()
  const server = useServer()
  const settings = useSettings()
  const language = useLanguage()

  return (
    <Show when={settings.general.voice() && (props.view || props.onUnavailable) && voice.state.status === "idle"}>
      <Tooltip placement="top" value={language.t("voice.call")}>
        <IconButton
          data-action="composer-voice-call"
          type="button"
          size="large"
          variant="ghost"
          class="voice-call-start"
          icon={<Icon name="voice" />}
          aria-label={language.t("voice.call")}
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
          onClick={() => {
            const view = props.view

            if (view) voice.begin(server.key, server.ctx, view)
            else props.onUnavailable?.()
          }}
        />
      </Tooltip>
    </Show>
  )
}

/** A live call in the composer's controls row, on the call this server has. */
export function VoiceCallControls() {
  const voice = useVoice()

  return (
    <VoiceCallBar
      call={voice.state}
      meter={voice.meter}
      onMute={voice.mute}
      onCaptions={voice.toggleTranscript}
      onRejoin={() => void voice.rejoin()}
      onSetup={voice.setup}
      onEnd={() => void voice.end()}
    />
  )
}

/** The captions above the composer, on the call this server has. */
function VoiceTranscript() {
  const voice = useVoice()

  return <VoiceCaptions captions={voice.state.captions} />
}

type Caption = { utterance: number; speaker: CallState["speaker"]; text: string }

/** The call row: Mute and Captions, the voices' picture, then the time and End. */
export function VoiceCallBar(props: {
  call: Pick<CallState, "status" | "failure" | "muted" | "since"> & { transcript: boolean }
  meter: { mic: number; speaker: number }
  onMute: () => void
  onCaptions: () => void
  onRejoin: () => void
  onSetup: () => void
  onEnd: () => void
}) {
  const language = useLanguage()
  const dropped = () => props.call.status === "dropped"
  const muteLabel = () => language.t(props.call.muted ? "voice.unmute" : "voice.mute")
  const captionsLabel = () => language.t(props.call.transcript ? "voice.captions.hide" : "voice.captions.show")
  const endLabel = () => language.t(dropped() ? "voice.close" : "voice.end")

  return (
    <div
      class="voice-call-controls"
      data-status={props.call.status}
      role="group"
      aria-label={language.t("voice.panel")}
      // Presses keep focus in the editor, so typing carries on while the call is controlled.
      onMouseDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) event.preventDefault()
      }}
    >
      <Tooltip placement="top" value={muteLabel()}>
        <IconButton
          type="button"
          size="large"
          variant="ghost"
          class="voice-call-toggle"
          data-muted={props.call.muted ? "" : undefined}
          disabled={props.call.status !== "connected"}
          aria-pressed={props.call.muted}
          aria-label={muteLabel()}
          icon={<Icon name={props.call.muted ? "microphone-off" : "microphone"} />}
          onClick={() => props.onMute()}
        />
      </Tooltip>
      <Tooltip placement="top" value={captionsLabel()}>
        <IconButton
          type="button"
          size="large"
          variant="ghost"
          class="voice-call-toggle"
          aria-pressed={props.call.transcript}
          aria-label={captionsLabel()}
          icon={<Icon name="transcript" />}
          onClick={() => props.onCaptions()}
        />
      </Tooltip>
      <div class="voice-call-wave">
        <Show
          when={!dropped()}
          fallback={
            <span class="voice-call-note" role="alert">
              {language.t(`voice.failure.${props.call.failure ?? "dropped"}`)}
            </span>
          }
        >
          <VoiceScope meter={props.meter} status={props.call.status} muted={props.call.muted} />
        </Show>
      </div>
      <span class="voice-call-time" role="status">
        <Show when={props.call.status === "connecting"}>{language.t("voice.connecting")}</Show>
        <Show when={props.call.status === "connected" && props.call.since} keyed>
          {(since) => <Elapsed since={since} />}
        </Show>
      </span>
      <Show when={dropped()}>
        <Show
          when={props.call.failure === "unavailable"}
          fallback={
            <Button type="button" variant="neutral" onClick={() => props.onRejoin()}>
              {language.t("voice.rejoin")}
            </Button>
          }
        >
          <Button type="button" variant="neutral" onClick={() => props.onSetup()}>
            {language.t("voice.setup")}
          </Button>
        </Show>
      </Show>
      <Tooltip placement="top" value={endLabel()}>
        <IconButton
          type="button"
          size="large"
          variant="ghost"
          class="voice-call-end"
          data-dropped={dropped() ? "" : undefined}
          aria-label={endLabel()}
          icon={<Icon name={dropped() ? "close" : "phone-hangup"} />}
          onClick={() => props.onEnd()}
        />
      </Tooltip>
    </div>
  )
}

/** The call's captions, newest at the bottom: the agent's lines in the primary colour, yours muted. */
export function VoiceCaptions(props: { captions: readonly Caption[] }) {
  const language = useLanguage()
  let list!: HTMLDivElement

  // Stays at the newest line while it grows, unless the reader scrolled up.
  createEffect(() => {
    const last = props.captions.at(-1)

    if (!last?.text || !list) return

    if (list.scrollHeight - list.clientHeight - list.scrollTop < 48) list.scrollTop = list.scrollHeight
  })

  return (
    <section class="voice-transcript" aria-label={language.t("voice.captions")} aria-live="polite">
      <div ref={list} class="voice-transcript-list" data-scrollable>
        <Show
          when={props.captions.length}
          fallback={<p class="voice-transcript-empty">{language.t("voice.transcript.empty")}</p>}
        >
          <For each={props.captions}>
            {(caption) => (
              <p class="voice-transcript-line" data-speaker={caption.speaker}>
                <span class="sr-only">{language.t(caption.speaker === "user" ? "voice.you" : "voice.assistant")} </span>
                {caption.text}
              </p>
            )}
          </For>
        </Show>
      </div>
    </section>
  )
}

function Elapsed(props: { since: number }) {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  const text = () => {
    const seconds = Math.max(0, Math.floor((now() - props.since) / 1000))
    const minutes = Math.floor(seconds / 60)

    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
  }

  return <>{text()}</>
}
