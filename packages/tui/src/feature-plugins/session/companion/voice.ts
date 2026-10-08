import type { OpenCodeClient, VoiceSpeechFormat } from "@opencode/client"
import { createStore } from "solid-js/store"
import { encode, monitor, play, record, rms, type Recording } from "./audio"
import { createBargeDetector, echoes, type Utterance } from "./barge"

export type VoiceStatus = "idle" | "listening" | "transcribing" | "speaking"

// Keeps the microphone open across the short gaps between sentences of one reply.
const MONITOR_GRACE_MS = 1500

/**
 * Voice loop. By default it is half-duplex: the microphone is closed while
 * speech plays, so speaker output never reaches the transcript. With
 * `bargeIn`, the microphone stays open during playback. Talking over the
 * reply stops it at once. A transcript that is the reply's own echo resumes
 * it from the interrupted sentence; any other is reported with `interrupting`.
 */
export function createVoice(input: {
  readonly client: OpenCodeClient
  readonly bargeIn: () => boolean
  readonly onTranscript: (text: string, interrupting: boolean) => void
  readonly onError: (error: unknown) => void
}) {
  const [state, setState] = createStore({ status: "idle" as VoiceStatus, level: 0 })
  let recording: Recording | undefined
  let speech = new AbortController()
  let playback = Promise.resolve()
  let queued = 0
  // Texts in the order their playback started, to recognise echo in a transcript.
  let played: string[] = []
  let turn = 0
  let listener: Promise<Awaited<ReturnType<typeof monitor>> | undefined> | undefined
  let closing = Promise.resolve()
  let grace: ReturnType<typeof setTimeout> | undefined
  let deciding = false
  // Texts that have not finished playing, and while the user talks over the reply, the ones held back.
  let unplayed: { text: string }[] = []
  let held: string[] | undefined

  const detector = createBargeDetector({
    onOnset: () => {
      held = unplayed.map((entry) => entry.text)
      unplayed = []
      speech.abort()
      speech = new AbortController()
      setState({ status: "listening", level: 0 })
    },
    onUtterance: (utterance) => void decide(utterance),
  })

  const transcript = (audio: Uint8Array) =>
    input.client.voice
      .transcribe({ mediaType: "audio/wav", payload: audio })
      .then((result) => result.text.trim())
      .catch((error) => {
        input.onError(error)
        return ""
      })

  const decide = async (utterance: Utterance) => {
    const current = turn
    deciding = true
    setState({ status: "transcribing", level: 0 })
    const text = await transcript(encode(utterance.samples, utterance.sampleRate))
    if (current !== turn) return
    deciding = false
    if (text && !echoes(text, played.join(" "))) {
      stop()
      input.onTranscript(text, true)
      return
    }
    if (text) detector.rejected()
    const resumed = held ?? []
    held = undefined
    setState("status", "idle")
    resumed.forEach(speak)
    if (resumed.length === 0) close()
  }

  const open = () => {
    clearTimeout(grace)
    if (listener || !input.bargeIn()) return
    detector.reset()
    listener = monitor((samples, sampleRate, level) => {
      if (deciding) return
      detector.push(samples, sampleRate, level)
      if (detector.active) setState("level", rms(samples))
    }).catch((error) => {
      input.onError(error)
      return undefined
    })
  }

  const close = () => {
    clearTimeout(grace)
    const current = listener
    listener = undefined
    detector.reset()
    if (current) closing = current.then((opened) => opened?.close()).catch(() => undefined)
  }

  const listen = async () => {
    stop()
    const current = turn
    setState({ status: "listening", level: 0 })
    // OpenTUI allows one capture at a time.
    await closing
    if (current !== turn) return
    recording = await record((level) => setState("level", level)).catch((error) => {
      setState("status", "idle")
      input.onError(error)
      return undefined
    })
  }

  const transcribe = async () => {
    const active = recording
    recording = undefined
    if (!active) return
    const current = turn
    setState({ status: "transcribing", level: 0 })
    const audio = await active.stop()
    const text = audio ? await transcript(audio) : ""
    // Stopping while the utterance transcribes discards it.
    if (current !== turn) return
    setState("status", "idle")
    if (text) input.onTranscript(text, false)
  }

  const stop = () => {
    turn++
    speech.abort()
    speech = new AbortController()
    recording?.cancel()
    recording = undefined
    close()
    deciding = false
    played = []
    unplayed = []
    held = undefined
    setState({ status: "idle", level: 0 })
  }

  const speak = (text: string) => {
    if (held) return void held.push(text)
    const controller = speech
    const signal = controller.signal
    const clip = fetchClip(input.client, text, signal)
    clip.catch(() => undefined)
    const entry = { text }
    unplayed.push(entry)
    queued++
    if (state.status === "idle") setState("status", "speaking")
    open()
    playback = playback
      .then(async () => {
        if (signal.aborted) return
        const loaded = await clip
        played = [...played.slice(-1), text]
        await play(loaded.format, loaded.body, signal)
      })
      .catch((error) => {
        if (signal.aborted) return
        // One failure drops the rest of the reply instead of reporting every sentence.
        controller.abort()
        input.onError(error)
      })
      .finally(() => {
        unplayed = unplayed.filter((item) => item !== entry)
        queued--
        if (queued > 0) return
        if (state.status === "speaking") setState("status", "idle")
        if (detector.active || deciding) return
        clearTimeout(grace)
        grace = setTimeout(close, MONITOR_GRACE_MS)
      })
  }

  return {
    state,
    /** Starts listening, or ends the utterance and transcribes it. */
    toggle() {
      if (state.status === "transcribing") return
      if (detector.active) return detector.flush()
      if (state.status === "listening") return void transcribe()
      void listen()
    },
    /** Stops listening and speaking. */
    stop,
    /** Queues one chunk of text; its audio request starts now so playback has no gap. */
    speak,
  }
}

export type Voice = ReturnType<typeof createVoice>

async function fetchClip(client: OpenCodeClient, text: string, signal: AbortSignal) {
  const events = client.voice.speech({ text }, { signal })[Symbol.asyncIterator]()
  const first = await events.next()
  if (first.done) throw new Error("Speech ended before any audio")
  if (first.value.type === "error") throw new Error(first.value.message)
  if (first.value.type !== "format") throw new Error("Speech started without a format")
  const format: VoiceSpeechFormat = first.value.format
  async function* body() {
    while (true) {
      const next = await events.next()
      if (next.done || next.value.type === "done") return
      if (next.value.type === "error") throw new Error(next.value.message)
      if (next.value.type === "audio") yield new Uint8Array(Buffer.from(next.value.data, "base64"))
    }
  }
  return { format, body: body() }
}

/** Text worth reading aloud: code blocks, including one still streaming, and markdown syntax are dropped. */
export function speakable(text: string) {
  const closed = text.replace(/```[\s\S]*?```/g, " ")
  const open = closed.indexOf("```")
  return (open === -1 ? closed : closed.slice(0, open))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_#>|]/g, "")
    .replace(/\s+/g, " ")
}

/**
 * Splits `text` after `from` into complete sentences. Short sentences merge
 * with the next one so each speech request carries enough text to sound
 * natural. When `final`, the remainder is flushed too.
 */
export function sentences(text: string, from: number, final: boolean) {
  const boundaries = Array.from(text.slice(from).matchAll(/[.!?…:;]+["')\]]*(?=\s)/g), (match) => {
    return from + (match.index ?? 0) + match[0].length
  })
  const cuts = boundaries.reduce<number[]>((result, boundary) => {
    const start = result.at(-1) ?? from
    return text.slice(start, boundary).trim().length >= 40 ? [...result, boundary] : result
  }, [])
  const ends = final && text.slice(cuts.at(-1) ?? from).trim() ? [...cuts, text.length] : cuts
  return {
    chunks: ends.map((end, index) => text.slice(ends[index - 1] ?? from, end).trim()).filter(Boolean),
    end: ends.at(-1) ?? from,
  }
}
