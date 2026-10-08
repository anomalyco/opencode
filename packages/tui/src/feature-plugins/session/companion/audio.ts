import type { Audio, AudioCaptureStream, AudioStream } from "@opentui/core"
import type { VoiceSpeechFormat } from "@opencode/client"
import { getAudio } from "../../../audio"
import { concat, energy } from "./barge"

const TRANSCRIBE_RATE = 16000
// About a third of a second at 48 kHz: longer than the speaker-to-microphone delay.
const TAP_FRAMES = 16384
const TAP_BLOCK = 1024

export type Recording = {
  /** Stops capture and returns the utterance as 16 kHz mono WAV, or undefined when nothing was captured. */
  readonly stop: () => Promise<Uint8Array | undefined>
  readonly cancel: () => void
}

export async function record(onLevel: (level: number) => void): Promise<Recording> {
  const audio = getAudio()
  if (!audio) throw new Error("Audio is unavailable in this terminal")
  const capture = await audio.openCapture({ channels: 1 })
  const chunks: Float32Array[] = []
  const reader = capture.readable.getReader()
  const pump = (async () => {
    while (true) {
      const next = await reader.read()
      if (next.done) return
      chunks.push(next.value)
      onLevel(rms(next.value))
    }
  })().catch(() => undefined)
  return {
    async stop() {
      await finish(capture, pump)
      const samples = concat(chunks)
      if (samples.length < capture.sampleRate / 4) return undefined
      return encode(samples, capture.sampleRate)
    },
    cancel() {
      void finish(capture, pump)
    },
  }
}

/** Opens the microphone during playback. Each chunk comes with the loudest block of recent playback. */
export async function monitor(onChunk: (samples: Float32Array, sampleRate: number, playback: number) => void) {
  const audio = getAudio()
  if (!audio) throw new Error("Audio is unavailable in this terminal")
  if (!audio.enableTap(TAP_FRAMES)) throw new Error("Audio playback cannot be monitored")
  const capture = await audio.openCapture({ channels: 1 }).catch((error) => {
    audio.disableTap()
    return Promise.reject(error)
  })
  const reader = capture.readable.getReader()
  const pump = (async () => {
    while (true) {
      const next = await reader.read()
      if (next.done) return
      onChunk(next.value, capture.sampleRate, playbackLevel(audio))
    }
  })().catch(() => undefined)
  return {
    async close() {
      await finish(capture, pump)
      audio.disableTap()
    },
  }
}

function playbackLevel(audio: Audio) {
  const tap = audio.readTapFrames(TAP_FRAMES, 1)
  if (!tap) return 0
  return Array.from({ length: Math.ceil(tap.framesRead / TAP_BLOCK) }, (_, index) =>
    energy(tap.frames.subarray(index * TAP_BLOCK, Math.min(tap.framesRead, (index + 1) * TAP_BLOCK))),
  ).reduce((loudest, level) => Math.max(loudest, level), 0)
}

/** Encodes captured samples as 16 kHz mono WAV for transcription. */
export function encode(samples: Float32Array, sampleRate: number) {
  return wav(resample(samples, sampleRate, TRANSCRIBE_RATE), TRANSCRIBE_RATE)
}

async function finish(capture: AudioCaptureStream, pump: Promise<unknown>) {
  capture.stop()
  await pump
  capture.dispose()
}

/** Plays one clip and resolves when playback ends or is stopped. */
export async function play(format: VoiceSpeechFormat, body: AsyncIterable<Uint8Array>, signal: AbortSignal) {
  const audio = getAudio()
  if (!audio) throw new Error("Audio is unavailable in this terminal")
  if (!audio.isStarted() && !audio.start()) throw new Error("Audio playback could not start")
  const stream: AudioStream = await (
    format.type === "mp3"
      ? audio.playStream(body, { format: "mp3", signal })
      : audio.playStream(pcm(body), {
          format: "pcm",
          sampleFormat: "f32le",
          sampleRate: format.sampleRate,
          channels: format.channels === 2 ? 2 : 1,
          signal,
        })
  ).catch((error) => Promise.reject(cause(error)))
  // Aborting the signal disposes the stream, which closes it.
  await Promise.race([
    stream.closed,
    new Promise<never>((_, reject) => stream.on("error", (error) => reject(cause(error)))),
  ])
}

// OpenTUI wraps source failures; the provider's message is more useful than "source failed".
function cause(error: unknown) {
  return error instanceof Error && error.cause instanceof Error ? error.cause : error
}

// Providers return signed 16-bit PCM; OpenTUI plays float PCM.
async function* pcm(body: AsyncIterable<Uint8Array>) {
  let carry = new Uint8Array(0)
  for await (const chunk of body) {
    const bytes = carry.length === 0 ? chunk : concatBytes(carry, chunk)
    const even = bytes.length - (bytes.length % 2)
    carry = bytes.slice(even)
    const view = new DataView(bytes.buffer, bytes.byteOffset, even)
    const samples = new Float32Array(even / 2)
    for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true) / 32768
    yield new Uint8Array(samples.buffer)
  }
}

/** Level for the meter, from 0 to 1. */
export function rms(samples: Float32Array) {
  return Math.min(1, energy(samples) * 4)
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.length + right.length)
  result.set(left)
  result.set(right, left.length)
  return result
}

// Box-filter decimation: averaging each output window also removes most aliasing.
function resample(samples: Float32Array, from: number, to: number) {
  if (from === to) return samples
  const ratio = from / to
  const result = new Float32Array(Math.floor(samples.length / ratio))
  for (let index = 0; index < result.length; index++) {
    const start = Math.floor(index * ratio)
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((index + 1) * ratio)))
    let sum = 0
    for (let cursor = start; cursor < end; cursor++) sum += samples[cursor] ?? 0
    result[index] = sum / (end - start)
  }
  return result
}

function wav(samples: Float32Array, sampleRate: number) {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) =>
    Array.from(text).forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  ascii(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true))
  return bytes
}
