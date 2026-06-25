import type { VoicePhase } from "./voice"
import {
  createVoiceSidecarSession,
  parseVoiceSidecarEvent,
  type VoiceSidecarEvent,
} from "./voice-sidecar"
import { hostedVoiceSidecarUrl } from "@/utils/hosted-url"
import { fetchVoiceSpeak } from "./voice-api"
import { voiceLogStage } from "./voice-log"

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
  onTtsActiveChange?: (active: boolean) => void
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
    if (sendAudio === enabled) return
    sendAudio = enabled
    voiceLogStage("RUNTIME", `mic send ${enabled ? "on" : "off"}`)
  }

  const stopTts = () => {
    if (!ttsElement) return
    ttsElement.pause()
    ttsElement.removeAttribute("src")
    ttsElement.onended = null
    ttsElement.onerror = null
  }

  const setTtsActive = (active: boolean) => {
    if (ttsActive === active) return
    ttsActive = active
    if (active) setMicSend(false)
    options.onTtsActiveChange?.(active)
  }

  const cancelTts = () => {
    voiceLogStage("PLAY", "cancel tts")
    ttsQueue = []
    stopTts()
    setTtsActive(false)
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
    options.setPhase("listening")
    resolveSpeakWait()
  }

  const maybeBargeIn = (text: string, speechFinal: boolean) => {
    if (!ttsActive && phase !== "speaking") return
    if (!speechFinal && text.trim().length < 3) return
    if (!/\b(stop|quiet|enough|hold on|wait)\b/.test(text.trim().toLowerCase())) return
    voiceLogStage("RUNTIME", `barge-in ${speechFinal ? "final" : "partial"} "${text.slice(0, 40)}"`)
    cancelTts()
  }

  const playTtsMp3 = async (base64: string) => {
    setMicSend(false)
    ttsQueue.push(base64)
    if (ttsActive) return
    setTtsActive(true)
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
        voiceLogStage("PLAY", `play ${encoded.length} chars b64`)
        await audio.play()
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve()
          audio.onerror = () => reject(new Error("playback failed"))
        })
        voiceLogStage("PLAY", "play done")
      } catch (error) {
        const message = error instanceof Error ? error.message : "playback failed"
        voiceLogStage("PLAY", `play error ${message}`)
        options.onError("voice playback blocked — click the page and try again")
      } finally {
        audio.removeAttribute("src")
        audio.onended = null
        audio.onerror = null
      }
    }

    setTtsActive(false)
    finishSpeaking()
  }

  const handleEvent = (event: VoiceSidecarEvent) => {
    if (event.type === "ready") {
      voiceLogStage("RUNTIME", "stream ready")
      phase = "listening"
      options.setPhase("listening")
      return
    }
    if (event.type === "transcript") {
      if (event.speechFinal) {
        voiceLogStage("RUNTIME", `transcript-final "${event.text.slice(0, 60)}"`)
      }
      if (event.text.trim()) options.onTranscript?.(event.text, { final: event.final, speechFinal: event.speechFinal })
      maybeBargeIn(event.text, event.speechFinal)
      if (event.speechFinal) options.onSpeechFinal?.(event.text)
      return
    }
    if (event.type === "status") {
      if (event.state === "listening") {
        if (ttsActive || speakDone) return
        phase = "listening"
        void unlockAudio()
        options.setPhase("listening")
      }
      if (event.state === "idle") {
        if (ttsActive) return
        phase = "listening"
        options.setPhase("listening")
      }
      if (event.state === "transcribing") {
        phase = "transcribing"
        options.setPhase("transcribing")
      }
      if (event.state === "working") {
        phase = "transcribing"
        options.setPhase("transcribing")
      }
      if (event.state === "speaking") {
        phase = "speaking"
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
      voiceLogStage("RUNTIME", `stream error ${event.message}`)
      resolveSpeakWait()
      if (ttsActive) {
        setTtsActive(false)
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
    setMicSend(true)
  }

  const stop = () => {
    voiceLogStage("RUNTIME", "runtime stop")
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
      socket.onopen = () => {
        voiceLogStage("RUNTIME", "websocket open")
        resolve()
      }
      socket.onerror = () => {
        voiceLogStage("RUNTIME", "websocket error")
        reject(new Error("voice stream connection failed"))
      }
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return
        const event = parseVoiceSidecarEvent(message.data)
        if (event) handleEvent(event)
      }
      socket.onclose = () => {
        voiceLogStage("RUNTIME", "websocket closed")
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
    voiceLogStage("RUNTIME", "runtime start")
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
    await speakAndWait(text)
  }

  const speakAndWait = async (
    text: string,
    raw = false,
    prefetchedEncoding?: string,
    shouldContinue?: () => boolean,
  ) => {
    if (shouldContinue && !shouldContinue()) return
    if (!text.trim()) return
    setMicSend(false)
    try {
      if (prefetchedEncoding) {
        await playTtsMp3(prefetchedEncoding)
      } else {
        const result = await fetchVoiceSpeak({
          sidecarUrl: options.sidecarUrl,
          text,
          raw,
        })
        if (shouldContinue && !shouldContinue()) return
        await playTtsMp3(result.data)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "voice speak failed"
      voiceLogStage("PLAY", `speak error ${message}`)
      options.onError(message)
    }
    if (shouldContinue && !shouldContinue()) return
  }

  const speakPlanParts = async (
    texts: string[],
    options?: {
      raw?: boolean
      beforeLastPart?: () => void
      loadTts?: (text: string, raw: boolean) => Promise<string>
      offerAtEnd?: boolean
      shouldContinue?: () => boolean
    },
  ) => {
    for (let index = 0; index < texts.length; index++) {
      if (options?.shouldContinue && !options.shouldContinue()) return
      const text = texts[index]
      if (!text?.trim()) continue
      if (options?.beforeLastPart && index === texts.length - 1) options.beforeLastPart()
      const isOfferPart = !!(options?.offerAtEnd && index === texts.length - 1)
      voiceLogStage("TTS", `plan-part ${index + 1}/${texts.length} offer=${isOfferPart} ${text.slice(0, 50)}`)
      const encoding = options?.loadTts ? await options.loadTts(text, options?.raw ?? true) : undefined
      if (options?.shouldContinue && !options.shouldContinue()) return
      await speakAndWait(text, options?.raw ?? true, encoding, options?.shouldContinue)
      if (options?.shouldContinue && !options.shouldContinue()) return
    }
  }

  const speakParts = async (texts: string[]) => {
    await speakPlanParts(texts)
  }

  const stopSpeaking = () => {
    cancelTts()
    if (!running) return
    phase = "listening"
    options.setPhase("listening")
  }

  const speaking = () => ttsActive

  return {
    start,
    stop,
    speak,
    speakParts,
    speakPlanParts,
    stopSpeaking,
    speaking,
    setMicSend: (enabled: boolean) => setMicSend(running && enabled),
  }
}
