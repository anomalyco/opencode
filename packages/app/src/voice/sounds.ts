// The call's cues: the iOS call's Breath Ping set (Wisp's default), converted from its bundled cues. The call start
// plays over the connecting loop; on connect the loop lets go and the connect chime plays; a call that was live hangs
// up with a sigh. The agent's tool calls tick softly: Look reads, Open moves the screen, Steer messages or waits on a
// session. The loop is WAV so it repeats without the gap AAC's encoder delay would leave.
import callStart from "./sounds/call-start.aac"
import connect from "./sounds/connect.aac"
import connectingLoop from "./sounds/connecting-loop.wav"
import hangUp from "./sounds/hang-up.aac"
import toolLook from "./sounds/tool-look.aac"
import toolOpen from "./sounds/tool-open.aac"
import toolSteer from "./sounds/tool-steer.aac"

const files = { callStart, connect, connectingLoop, hangUp, toolLook, toolOpen, toolSteer }

type Cue = keyof typeof files

const tools = new Map<string, Cue>([
  ["read_session", "toolLook"],
  ["search_sessions", "toolLook"],
  ["open_session", "toolOpen"],
  ["create_session", "toolOpen"],
  ["send_message", "toolSteer"],
  ["wait_for_session", "toolSteer"],
  ["interrupt_session", "toolSteer"],
])

// A burst of tools is one sound, as on iOS.
const toolGap = 450

type Bank = { context: AudioContext; buffers: Map<Cue, Promise<AudioBuffer | undefined>> }

type Playing = { source: AudioBufferSourceNode; gain: GainNode }

/** The cues' audio, the connecting loop playing or loading for a press, and the last tool tick. */
type Sounds = { bank?: Bank; loop?: Playing; press: number; looping?: number; toolAt: number; enabled: boolean }

const state: Sounds = { press: 0, toolAt: -Infinity, enabled: true }

function bank() {
  if (typeof AudioContext === "undefined") return
  state.bank ??= { context: new AudioContext(), buffers: new Map() }

  if (state.bank.context.state === "suspended") void state.bank.context.resume()

  return state.bank
}

function buffer(b: Bank, cue: Cue) {
  const loaded =
    b.buffers.get(cue) ??
    fetch(files[cue])
      .then((response) => response.arrayBuffer())
      .then((data) => b.context.decodeAudioData(data))
      .catch(() => undefined)

  b.buffers.set(cue, loaded)

  return loaded
}

async function play(cue: Cue, loop = false, delay = 0) {
  if (!state.enabled) return
  const b = bank()

  if (!b) return
  const audio = await buffer(b, cue)

  if (!audio) return
  const source = b.context.createBufferSource()
  const gain = b.context.createGain()
  source.buffer = audio
  source.loop = loop
  source.connect(gain).connect(b.context.destination)
  source.start(b.context.currentTime + delay)

  return { source, gain }
}

// Lets the connecting loop go with a short fade, so it never clicks off; a loop still loading never starts.
function release() {
  const loop = state.loop
  state.loop = undefined
  state.looping = undefined

  if (!loop || !state.bank) return
  const now = state.bank.context.currentTime
  loop.gain.gain.setValueAtTime(loop.gain.gain.value, now)
  loop.gain.gain.linearRampToValueAtTime(0, now + 0.03)
  loop.source.stop(now + 0.05)
}

export const VoiceSounds = {
  /** Settings › Call sounds: off silences every cue, and a loop already playing. */
  enable(on: boolean) {
    state.enabled = on

    if (!on) release()
  },
  /** The call button was pressed: the start cue over the connecting loop, until it connects or ends. */
  press() {
    release()
    const press = ++state.press
    state.looping = press
    void play("callStart")
    void play("connectingLoop", true).then((loop) => {
      if (!loop) return

      if (state.looping !== press) return loop.source.stop()
      state.loop = loop
    })
    const b = bank()

    // The rest load while the call connects.
    if (b)
      (["connect", "hangUp", "toolLook", "toolOpen", "toolSteer"] satisfies Cue[]).forEach((cue) => void buffer(b, cue))
  },
  /** The call connected and the voice agent can hear you. */
  connect() {
    release()
    // After the loop's 30 ms fade, so the two never overlap, as on iOS.
    void play("connect", false, 0.03)
  },
  /** The call ended before it connected: the loop stops, with no hang-up. */
  cancel() {
    release()
  },
  /** A live call ended, by you, the agent or a drop. */
  end() {
    release()
    void play("hangUp")
  },
  /** The voice agent's delegator ran a tool; tools without a cue, and ticks within 450 ms of the last, stay quiet. */
  tool(name: string) {
    const cue = tools.get(name)

    if (!cue || performance.now() - state.toolAt < toolGap) return
    state.toolAt = performance.now()
    void play(cue)
  },
}
