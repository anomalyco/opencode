// The call's cues, synthesised like the iOS call's "Breath Ping" set: a sine that fades in over 25 ms with a whisper of
// low-passed air, under a 1.8 kHz low-pass. Consonant intervals only; nothing bright or clicky. A press pings once,
// connecting plays a rising G4–D5–G5 chord, and hanging up or dropping falls D5 then G4.

const notes = { G4: 392, D5: 587.33, G5: 783.99 }

// The press's ping sits about 9 dB under the connect and hang-up cues.
const level = { cue: 0.22, ping: 0.078 }

type Audio = { context: AudioContext; out: AudioNode; noise: AudioBuffer }

let shared: Audio | undefined

function audio() {
  if (typeof AudioContext === "undefined") return
  shared ??= create()

  if (shared.context.state === "suspended") void shared.context.resume()

  return shared
}

function create(): Audio {
  const context = new AudioContext()
  const lowpass = context.createBiquadFilter()
  lowpass.type = "lowpass"
  lowpass.frequency.value = 1800
  lowpass.connect(context.destination)
  const noise = context.createBuffer(1, context.sampleRate, context.sampleRate)
  noise.getChannelData(0).forEach((_, index, data) => (data[index] = Math.random() * 2 - 1))

  return { context, out: lowpass, noise }
}

function tone(a: Audio, frequency: number, at: number, peak: number, decay: number) {
  const context = a.context
  const sine = context.createOscillator()
  sine.type = "sine"
  sine.frequency.value = frequency
  const envelope = context.createGain()
  envelope.gain.setValueAtTime(0, at)
  envelope.gain.linearRampToValueAtTime(peak, at + 0.025)
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  sine.connect(envelope).connect(a.out)
  sine.start(at)
  sine.stop(at + decay + 0.05)

  // The breath: a little low-passed noise under the note's attack.
  const air = context.createBufferSource()
  air.buffer = a.noise
  const soften = context.createBiquadFilter()
  soften.type = "lowpass"
  soften.frequency.value = 900
  const breath = context.createGain()
  breath.gain.setValueAtTime(0, at)
  breath.gain.linearRampToValueAtTime(peak * 0.12, at + 0.02)
  breath.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
  air.connect(soften).connect(breath).connect(a.out)
  air.start(at, Math.random() * 0.5, 0.25)
}

export const VoiceSounds = {
  /** The call button was pressed: one soft ping while the call sets up. */
  press() {
    const a = audio()

    if (a) tone(a, notes.G4, a.context.currentTime + 0.01, level.ping, 0.4)
  },
  /** The call connected and the voice agent can hear you. */
  connect() {
    const a = audio()

    if (!a) return
    const at = a.context.currentTime + 0.01
    tone(a, notes.G4, at, level.cue, 0.7)
    tone(a, notes.D5, at + 0.13, level.cue, 0.7)
    tone(a, notes.G5, at + 0.26, level.cue * 0.85, 0.9)
  },
  /** The call ended, by you or by a drop. */
  end() {
    const a = audio()

    if (!a) return
    const at = a.context.currentTime + 0.01
    tone(a, notes.D5, at, level.cue, 0.5)
    tone(a, notes.G4, at + 0.16, level.cue, 0.7)
  },
}
