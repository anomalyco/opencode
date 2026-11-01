import { onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { CallState } from "./call"
import { VoiceCallBar, VoiceCaptions } from "./composer"

export default {
  title: "OpenCode/Voice/Call composer",
  id: "voice-call-composer",
  args: { captions: false },
  parameters: {
    docs: {
      description: {
        component:
          "A live voice call in the composer, on a scripted call that loops: connecting, you ask, the agent answers, a short overlap, then the agent speaks while you're muted.",
      },
    },
  },
}

export const Call = {
  render: (args: { captions?: boolean }) => {
    const call = createScriptedCall()

    return (
      <div class="w-[680px] max-w-full">
        <CallComposer call={call} captions={!!args.captions} />
      </div>
    )
  },
}

// A call this server can't place: the bar offers setup instead of Rejoin.
export const NotSetUp = {
  name: "Dropped: GPT-Live not set up",
  render: () => (
    <div class="w-[680px] max-w-full">
      <CallComposer
        call={{
          state: { status: "dropped", failure: "unavailable", muted: false, captions: [] },
          meter: { mic: 0, speaker: 0 },
          mute: () => undefined,
        }}
        captions={false}
      />
    </div>
  ),
}

type ScriptedCall = ReturnType<typeof createScriptedCall>

function CallComposer(props: { call: ScriptedCall; captions: boolean }) {
  const [local, setLocal] = createStore({ transcript: props.captions })

  return (
    <div class="flex flex-col">
      <Show when={local.transcript}>
        <VoiceCaptions captions={props.call.state.captions} />
      </Show>
      <div class="rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
        <div class="ps-4 pe-4 pt-4 pb-2 text-[13px] leading-5 font-[440] text-v2-text-text-faint">
          Ask anything, / for commands, @ for context...
        </div>
        <div class="flex h-11 items-center px-2">
          <VoiceCallBar
            call={{ ...props.call.state, transcript: local.transcript }}
            meter={props.call.meter}
            onMute={props.call.mute}
            onCaptions={() => setLocal("transcript", (open) => !open)}
            onRejoin={() => undefined}
            onSetup={() => undefined}
            onEnd={() => undefined}
          />
        </div>
      </div>
    </div>
  )
}

// One loop of a call, in seconds: who speaks when, and what they say.
const script = {
  length: 16,
  connected: 1.6,
  turns: [
    { speaker: "user", from: 2.4, to: 5.2, text: "Can you check whether the desktop tests pass?" },
    {
      speaker: "assistant",
      from: 5.7,
      to: 9.6,
      text: "Sure, sending that to the desktop session now. I'll tell you when it lands.",
    },
    { speaker: "user", from: 10.1, to: 11.2, text: "Thanks, perfect." },
    { speaker: "assistant", from: 10.7, to: 11.3, text: "Mhm." },
    { speaker: "assistant", from: 12.4, to: 14.6, text: "The tests pass. All nine hundred are green." },
  ],
  muted: { from: 12, to: 15 },
} as const

function createScriptedCall() {
  const meter = { mic: 0, speaker: 0 }

  const [state, setState] = createStore<{
    status: CallState["status"]
    muted: boolean
    since?: number
    failure?: CallState["failure"]
    captions: { utterance: number; speaker: CallState["speaker"]; text: string }[]
  }>({ status: "connecting", muted: false, captions: [] })

  const started = performance.now()

  const tick = () => {
    const now = (performance.now() - started) / 1000
    const time = now % script.length
    const status = time < script.connected ? "connecting" : "connected"

    if (status !== state.status)
      setState({ status, since: status === "connected" ? Date.now() : undefined, captions: [] })

    const muted = time >= script.muted.from && time < script.muted.to

    if (muted !== state.muted) setState("muted", muted)

    // Speech as syllables inside a phrase that rises and falls.
    const level = (speaker: string) =>
      script.turns
        .filter((turn) => turn.speaker === speaker && time >= turn.from && time < turn.to)
        .reduce((sum, turn) => {
          const progress = (time - turn.from) / (turn.to - turn.from)
          const phrase = Math.sin(Math.PI * progress) ** 0.4
          const syllable = Math.abs(Math.sin(Math.PI * 4.3 * (time - turn.from))) ** 0.7

          return sum + (0.02 + 0.1 * syllable) * phrase * (0.8 + 0.2 * Math.sin(time * 2.3))
        }, 0)

    meter.mic = muted ? 0 : level("user")
    meter.speaker = level("assistant")

    const captions = script.turns.flatMap((turn, utterance) => {
      if (time < turn.from) return []
      const words = turn.text.split(" ")
      const shown = Math.ceil(words.length * Math.min(1, (time - turn.from) / (turn.to - turn.from)))

      return [{ utterance, speaker: turn.speaker, text: words.slice(0, shown).join(" ") }]
    })

    if (captions.map((caption) => caption.text).join("|") !== state.captions.map((caption) => caption.text).join("|"))
      setState("captions", captions)
  }

  const timer = setInterval(tick, 50)
  onCleanup(() => clearInterval(timer))
  tick()

  return {
    state,
    meter,
    mute: () => undefined,
  }
}
