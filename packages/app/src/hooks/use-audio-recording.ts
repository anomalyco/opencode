import { createSignal } from "solid-js"

function negotiateMime(): string {
  for (const mime of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ""
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const length = samples.length
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, "data")
  view.setUint32(40, length * 2, true)

  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  const arrayBuffer = await blob.arrayBuffer()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
  const samples = audioBuffer.getChannelData(0)
  await ctx.close()
  return encodeWav(samples, audioBuffer.sampleRate)
}

export function useAudioRecording() {
  const [recording, setRecording] = createSignal(false)
  let mediaRecorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let resolveBlob: ((blob: Blob) => void) | null = null
  let rejectBlob: ((err: unknown) => void) | null = null

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = negotiateMime()
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks = []

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      try {
        const raw = new Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" })
        stream.getTracks().forEach((t) => t.stop())
        const wav = await toWav(raw)
        resolveBlob?.(wav)
      } catch (err) {
        rejectBlob?.(err)
      } finally {
        resolveBlob = null
        rejectBlob = null
      }
    }

    mediaRecorder.start()
    setRecording(true)
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      resolveBlob = resolve
      rejectBlob = reject
      mediaRecorder?.stop()
      setRecording(false)
    })
  }

  return { recording, start, stop }
}
