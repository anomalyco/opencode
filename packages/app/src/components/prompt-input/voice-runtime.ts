import type { VoicePhase } from "./voice"
import {
  createVoiceSidecarSession,
  parseVoiceSidecarEvent,
  type VoiceSidecarEvent,
} from "./voice-sidecar"
import { hostedVoiceSidecarUrl } from "@/utils/hosted-url"

export type VoiceRuntimeOptions = {
  sidecarUrl?: () => string
  opencodeUrl: () => string
  directory: () => string
  sessionID: () => string | undefined
  agent: () => string
  setPhase: (phase: VoicePhase) => void
  onError: (message: string) => void
}

function downsampleTo16k(input: Float32Array, inputRate: number) {
  const ratio = inputRate / 16000
  const outLen = Math.floor(input.length / ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const idx = Math.floor(i * ratio)
    const s = Math.max(-1, Math.min(1, input[idx] ?? 0))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function base64ToBytes(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function createVoiceRuntime(options: VoiceRuntimeOptions) {
  let ws: WebSocket | undefined
  let sendAudio = false
  let running = false
  let audioContext: AudioContext | undefined
  let processor: ScriptProcessorNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let mediaStream: MediaStream | undefined
  let currentSource: AudioBufferSourceNode | undefined
  let currentAudio: HTMLAudioElement | undefined
  let ttsQueue: Blob[] = []
  let ttsPlaying = false
  let phase: VoicePhase = "listening"

  const setMicSend = (enabled: boolean) => {
    sendAudio = enabled
  }

  const stopTts = () => {
    if (currentSource) {
      try {
        currentSource.stop()
      } catch {
        // already stopped
      }
      currentSource.disconnect()
      currentSource = undefined
    }
    if (!currentAudio) return
    currentAudio.pause()
    currentAudio = undefined
  }

  const cancelTts = () => {
    ttsQueue = []
    stopTts()
    ttsPlaying = false
  }

  const resumeAudio = async () => {
    if (audioContext?.state === "suspended") await audioContext.resume()
  }

  const finishSpeaking = () => {
    if (!running) return
    phase = "listening"
    void resumeAudio()
    setMicSend(true)
    options.setPhase("listening")
  }

  const maybeBargeIn = (text: string, speechFinal: boolean) => {
    if (!ttsPlaying && phase !== "speaking") return
    if (!speechFinal || text.trim().length < 3) return
    cancelTts()
    if (running) setMicSend(true)
  }

  const playHtmlAudio = (blob: Blob) =>
    new Promise<void>((resolve) => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      currentAudio = audio
      audio.onended = () => {
        URL.revokeObjectURL(url)
        currentAudio = undefined
        resolve()
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        currentAudio = undefined
        options.onError("voice playback failed")
        resolve()
      }
      void audio.play().catch(() => {
        URL.revokeObjectURL(url)
        currentAudio = undefined
        options.onError("voice playback blocked — click the page and try again")
        resolve()
      })
    })

  const playTtsBlob = async (blob: Blob) => {
    setMicSend(false)
    ttsQueue.push(blob)
    if (ttsPlaying) return
    ttsPlaying = true

    while (ttsQueue.length > 0) {
      const item = ttsQueue.shift()
      if (!item) break

      stopTts()
      await resumeAudio()

      if (audioContext) {
        try {
          const buffer = await item.arrayBuffer()
          const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0))
          await new Promise<void>((resolve) => {
            const node = audioContext!.createBufferSource()
            node.buffer = audioBuffer
            node.connect(audioContext!.destination)
            currentSource = node
            node.onended = () => {
              currentSource = undefined
              resolve()
            }
            node.start(0)
          })
          continue
        } catch {
          // fall back to HTMLAudioElement below
        }
      }

      await playHtmlAudio(item)
    }

    ttsPlaying = false
    finishSpeaking()
  }

  const handleEvent = (event: VoiceSidecarEvent) => {
    if (event.type === "ready") {
      phase = "listening"
      options.setPhase("listening")
      return
    }
    if (event.type === "transcript") {
      maybeBargeIn(event.text, event.speechFinal)
      if (!event.speechFinal) options.setPhase("hearing")
      return
    }
    if (event.type === "status") {
      if (event.state === "listening") {
        if (ttsPlaying) return
        phase = "listening"
        void resumeAudio()
        setMicSend(running)
        options.setPhase("listening")
      }
      if (event.state === "idle") {
        if (ttsPlaying) return
        phase = "listening"
        setMicSend(running)
        options.setPhase("listening")
      }
      if (event.state === "transcribing") {
        phase = "transcribing"
        setMicSend(false)
        options.setPhase("transcribing")
      }
      if (event.state === "working") {
        phase = "transcribing"
        setMicSend(false)
        cancelTts()
        options.setPhase("transcribing")
      }
      if (event.state === "speaking") {
        phase = "speaking"
        setMicSend(false)
        void resumeAudio()
        options.setPhase("speaking")
      }
      return
    }
    if (event.type === "tts" && event.encoding === "base64") {
      try {
        const bytes = base64ToBytes(event.data)
        void playTtsBlob(new Blob([bytes], { type: "audio/mpeg" }))
      } catch {
        options.onError("voice audio decode failed")
      }
      return
    }
    if (event.type === "error") options.onError(event.message)
  }

  const stopMic = () => {
    running = false
    setMicSend(false)
    processor?.disconnect()
    source?.disconnect()
    if (audioContext) void audioContext.close()
    mediaStream?.getTracks().forEach((track) => track.stop())
    processor = undefined
    source = undefined
    audioContext = undefined
    mediaStream = undefined
  }

  const startMic = async () => {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    audioContext = new AudioContext()
    if (audioContext.state === "suspended") await audioContext.resume()
    source = audioContext.createMediaStreamSource(mediaStream)
    processor = audioContext.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event) => {
      if (!running || !sendAudio || !ws || ws.readyState !== WebSocket.OPEN) return
      const pcm = downsampleTo16k(event.inputBuffer.getChannelData(0), audioContext!.sampleRate)
      ws.send(pcm.buffer)
    }
    source.connect(processor)
    // Keep the processor alive without routing mic input to speakers (avoids echo + autoplay conflicts).
    const silent = audioContext.createGain()
    silent.gain.value = 0
    processor.connect(silent)
    silent.connect(audioContext.destination)
    running = true
    setMicSend(false)
  }

  const stop = () => {
    stopMic()
    cancelTts()
    if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    ws = undefined
  }

  const start = async () => {
    stop()
    const sessionID = options.sessionID()
    if (!sessionID) throw new Error("no session")

    const session = await createVoiceSidecarSession({
      sidecarUrl: options.sidecarUrl?.() ?? hostedVoiceSidecarUrl(),
      directory: options.directory(),
      sessionID,
      agent: options.agent(),
      server: options.opencodeUrl(),
    })

    await startMic()

    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(session.stream)
        ws = socket
        socket.binaryType = "arraybuffer"
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error("voice stream connection failed"))
        socket.onmessage = (message) => {
          if (typeof message.data !== "string") return
          const event = parseVoiceSidecarEvent(message.data)
          if (event) handleEvent(event)
        }
        socket.onclose = () => {
          if (running) options.onError("voice stream closed")
          stopMic()
        }
      })
    } catch (error) {
      stop()
      throw error
    }
  }

  return { start, stop }
}
