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
  onTranscript?: (text: string, input: { final: boolean; speechFinal: boolean }) => void
  onSpeechFinal?: (text: string) => void
}

// Minimal silent WAV — unlocks HTML audio during the mic click gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAA="

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

export function createVoiceRuntime(options: VoiceRuntimeOptions) {
  let ws: WebSocket | undefined
  let sendAudio = false
  let running = false
  let reconnecting = false
  let audioContext: AudioContext | undefined
  let processor: ScriptProcessorNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let mediaStream: MediaStream | undefined
  let ttsElement: HTMLAudioElement | undefined
  let ttsQueue: string[] = []
  let ttsActive = false
  let phase: VoicePhase = "listening"
  let speakDone: (() => void) | undefined
  let connectParams:
    | {
        sidecarUrl: string
        directory: string
        sessionID: string
        agent: string
        server: string
      }
    | undefined

  const resolveSpeakWait = () => {
    speakDone?.()
    speakDone = undefined
  }

  const setMicSend = (enabled: boolean) => {
    sendAudio = enabled
  }

  const stopTts = () => {
    if (!ttsElement) return
    ttsElement.pause()
    ttsElement.removeAttribute("src")
    ttsElement.onended = null
    ttsElement.onerror = null
  }

  const cancelTts = () => {
    ttsQueue = []
    stopTts()
    ttsActive = false
    resolveSpeakWait()
  }

  const unlockAudio = async () => {
    if (!audioContext || audioContext.state === "closed") return
    if (audioContext.state === "suspended") await audioContext.resume()
  }

  const finishSpeaking = () => {
    if (!running) return
    phase = "listening"
    void unlockAudio()
    setMicSend(true)
    options.setPhase("listening")
    resolveSpeakWait()
  }

  const maybeBargeIn = (text: string, speechFinal: boolean) => {
    if (!ttsActive && phase !== "speaking") return
    if (!speechFinal || text.trim().length < 3) return
    cancelTts()
    if (running) setMicSend(true)
  }

  const playTtsMp3 = async (base64: string) => {
    setMicSend(false)
    ttsQueue.push(base64)
    if (ttsActive) return
    ttsActive = true
    options.setPhase("speaking")

    while (ttsQueue.length > 0) {
      const encoded = ttsQueue.shift()
      if (!encoded) break

      stopTts()
      await unlockAudio()

      const audio = ttsElement ?? new Audio()
      ttsElement = audio
      audio.setAttribute("playsinline", "true")
      audio.src = `data:audio/mpeg;base64,${encoded}`
      try {
        await audio.play()
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve()
          audio.onerror = () => reject(new Error("playback failed"))
        })
      } catch {
        options.onError("voice playback blocked — click the page and try again")
      } finally {
        audio.removeAttribute("src")
        audio.onended = null
        audio.onerror = null
      }
    }

    ttsActive = false
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
      if (event.text.trim()) options.onTranscript?.(event.text, { final: event.final, speechFinal: event.speechFinal })
      if (event.speechFinal) options.onSpeechFinal?.(event.text)
      if (!event.speechFinal && event.text.trim()) options.setPhase("hearing")
      return
    }
    if (event.type === "status") {
      if (event.state === "listening") {
        if (ttsActive || speakDone) return
        phase = "listening"
        void unlockAudio()
        setMicSend(running)
        options.setPhase("listening")
      }
      if (event.state === "idle") {
        if (ttsActive) return
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
        options.setPhase("speaking")
      }
      return
    }
    if (event.type === "tts" && event.encoding === "base64") {
      void playTtsMp3(event.data)
      return
    }
    if (event.type === "speak" && event.skipped) {
      resolveSpeakWait()
      return
    }
    if (event.type === "error") {
      resolveSpeakWait()
      if (ttsActive) {
        ttsActive = false
        finishSpeaking()
      }
      options.onError(event.message)
    }
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
    ttsElement = undefined
    mediaStream = undefined
  }

  const startMic = async () => {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    audioContext = new AudioContext()
    await unlockAudio()
    ttsElement = new Audio()
    ttsElement.setAttribute("playsinline", "true")
    ttsElement.src = SILENT_WAV
    try {
      await ttsElement.play()
      ttsElement.pause()
      ttsElement.removeAttribute("src")
    } catch {
      // Browser may still allow later playback after further interaction.
    }
    source = audioContext.createMediaStreamSource(mediaStream)
    processor = audioContext.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event) => {
      if (!running || !sendAudio || !ws || ws.readyState !== WebSocket.OPEN) return
      const pcm = downsampleTo16k(event.inputBuffer.getChannelData(0), audioContext!.sampleRate)
      ws.send(pcm.buffer)
    }
    source.connect(processor)
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
    connectParams = undefined
  }

  const attachStream = (stream: string) =>
    new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(stream)
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
        if (!running) return
        if (reconnecting) return
        reconnecting = true
        void ensureConnected()
          .then((ok) => {
            reconnecting = false
            if (ok) return
            options.onError("voice stream closed — toggle voice off and on")
            stopMic()
          })
          .catch(() => {
            reconnecting = false
            options.onError("voice stream closed — toggle voice off and on")
            stopMic()
          })
      }
    })

  const ensureConnected = async () => {
    if (ws?.readyState === WebSocket.OPEN) return true
    if (!running || !connectParams) return false
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close()
      ws = undefined
    }
    try {
      const session = await createVoiceSidecarSession({
        sidecarUrl: connectParams.sidecarUrl,
        directory: connectParams.directory,
        sessionID: connectParams.sessionID,
        agent: connectParams.agent,
        server: connectParams.server,
        composer: true,
      })
      await attachStream(session.stream)
      return ws?.readyState === WebSocket.OPEN
    } catch {
      return false
    }
  }

  const start = async () => {
    stop()
    const sessionID = options.sessionID()
    if (!sessionID) throw new Error("no session")

    const sidecarUrl = options.sidecarUrl?.() ?? hostedVoiceSidecarUrl()
    const directory = options.directory()
    const agent = options.agent()
    const server = options.opencodeUrl()

    connectParams = { sidecarUrl, directory, sessionID, agent, server }

    const session = await createVoiceSidecarSession({
      sidecarUrl,
      directory,
      sessionID,
      agent,
      server,
      composer: true,
    })

    await startMic()

    try {
      await attachStream(session.stream)
    } catch (error) {
      stop()
      throw error
    }
  }

  const sendSpeak = async (text: string, raw = false) => {
    if (!text.trim()) return true
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const ok = await ensureConnected()
      if (!ok) {
        options.onError(
          "voice stream not connected — use voxcode web (not opencode web), ensure port 8765 is up, then toggle voice",
        )
        return false
      }
    }
    ws!.send(JSON.stringify({ type: "speak", text, raw }))
    return true
  }

  const speak = async (text: string) => {
    await sendSpeak(text)
  }

  const speakAndWait = async (text: string, raw = false) => {
    if (!text.trim()) return
    if (!(await sendSpeak(text, raw))) return
    await Promise.race([
      new Promise<void>((resolve) => {
        speakDone = resolve
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 20000)),
    ])
    resolveSpeakWait()
  }

  const speakParts = async (texts: string[]) => {
    for (const text of texts) {
      if (!text.trim()) continue
      await speakAndWait(text, true)
    }
  }

  const stopSpeaking = () => {
    cancelTts()
    if (!running) return
    phase = "listening"
    setMicSend(true)
    options.setPhase("listening")
  }

  const speaking = () => ttsActive

  return { start, stop, speak, speakParts, stopSpeaking, speaking }
}
