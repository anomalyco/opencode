import { createEffect, createSignal, onCleanup } from "solid-js"
import {
  fetchVoiceAck,
  fetchVoiceContinuationChunk,
  fetchVoiceDecide,
  fetchVoiceFinalSpeak,
  fetchVoiceSpeak,
  type VoiceProgressSnapshot,
} from "./api"
import { setVoiceLogListener, voiceLog, voiceLogResetOnce, voiceLogStage } from "./log"
import { playMp3, stopMp3, voiceSidecarBaseUrl } from "./play"
import { createVoiceSidecarSession, parseVoiceSidecarEvent } from "./sidecar"
import { voiceControlPlaneUrl } from "./url"

export type TuiVoicePhase = "off" | "listening" | "hearing" | "working" | "speaking" | "awaiting_reply"

type ConversationPhase = "listening" | "awaiting_agent" | "awaiting_reply"

export type TuiVoiceOptions = {
  sidecarUrl?: () => string
  opencodeUrl: () => string
  serverUrl?: () => string | undefined
  directory: () => string
  sessionID: () => string | undefined
  agent: () => string | undefined
  enabled: () => boolean
  working: () => boolean
  submitTranscript: (text: string) => void
  onTranscript?: (text: string) => void
  assistantReplyForVoiceTurn?: () => string | undefined
  progressSnapshot?: () => VoiceProgressSnapshot | undefined
  onError: (message: string) => void
}

function base64ToBytes(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const ASSISTANT_ECHO_FRAGMENTS = [
  "working on that",
  "checking that for you",
  "i'll be back",
  "ill be back",
  "i will be back",
  "want me to give you more",
  "go into more detail",
  "like to hear more",
  "would you like to hear more",
  "standing by to help",
]

function normalizeVoiceText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function textEchoesSpoken(input: string, spoken: string) {
  const left = normalizeVoiceText(input)
  const right = normalizeVoiceText(spoken)
  if (!left || !right) return false
  if (left === right) return true
  if (left.length >= 8 && right.includes(left)) return true
  if (right.length >= 8 && left.includes(right)) return true
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (shorter.length >= 12 && longer.includes(shorter)) return true
  return false
}

function wantsStopSpeech(text: string) {
  return /\b(stop|quiet|enough|hold on|wait)\b/.test(text.trim().toLowerCase())
}

const ACK_DELAY_MS = 3000
const ACK_RETRY_MS = 4000

export function createTuiVoice(options: TuiVoiceOptions) {
  const [active, setActive] = createSignal(false)
  const [phase, setPhase] = createSignal<TuiVoicePhase>("off")
  const [hearing, setHearing] = createSignal("")
  const [debug, setDebug] = createSignal("")

  setVoiceLogListener((line) => setDebug(line))
  onCleanup(() => setVoiceLogListener(undefined))
  voiceLogStage("STATE", "voice runtime ready")

  let ws: WebSocket | undefined
  let running = false
  let conversationPhase: ConversationPhase = "listening"
  const [awaitingSpeak, setAwaitingSpeak] = createSignal(false)
  let fullReplyText = ""
  let spokenSoFar = ""
  let pendingOffer = false
  let lastSpoken = ""
  let ttsActive = false
  let playGeneration = 0
  let micCooldownUntil = 0
  let partialText = ""
  let partialTimer: ReturnType<typeof setTimeout> | undefined
  let lastSubmitted = ""
  let ackTimer: ReturnType<typeof setTimeout> | undefined
  let speakInFlight = false

  const looksLikeAssistantEcho = (text: string) => {
    const normalized = normalizeVoiceText(text)
    if (!normalized) return true
    if (ASSISTANT_ECHO_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return true
    if (textEchoesSpoken(text, lastSpoken)) return true
    if (textEchoesSpoken(text, spokenSoFar)) return true
    if (textEchoesSpoken(text, fullReplyText)) return true
    return false
  }

  const micOpen = () => {
    if (ttsActive || speakInFlight) return false
    if (Date.now() < micCooldownUntil) return false
    if (conversationPhase === "awaiting_agent") return false
    return true
  }

  const syncMic = () => {
    setMicEnabled(micOpen())
  }

  const clearAckTimer = () => {
    if (!ackTimer) return
    clearTimeout(ackTimer)
    ackTimer = undefined
  }

  const maybePlayAck = (query: string, retry: boolean) => {
    if (conversationPhase !== "awaiting_agent") return
    if (!options.working()) return
    voiceLogStage("TTS", `ack-check retry=${retry}`)
    void fetchVoiceAck({
      sidecarUrl: sidecar(),
      text: query,
      progress: options.progressSnapshot?.(),
    })
      .then(async (ack) => {
        if (conversationPhase !== "awaiting_agent") return
        if (!options.working()) return
        if (ack.skip) {
          voiceLogStage("TTS", "ack-skip")
          if (!retry) {
            ackTimer = setTimeout(() => maybePlayAck(query, true), ACK_RETRY_MS)
          }
          return
        }
        if (!ack.text?.trim()) return
        voiceLogStage("TTS", `ack-play "${ack.text.slice(0, 40)}"`)
        lastSpoken = ack.text
        await speakText(ack.text, true)
      })
      .catch((error) => {
        options.onError(error instanceof Error ? error.message : "voice ack failed")
      })
  }

  const startAckTimer = () => {
    clearAckTimer()
    const query = lastSubmitted
    if (!query.trim()) return
    ackTimer = setTimeout(() => maybePlayAck(query, false), ACK_DELAY_MS)
  }

  const sidecar = () => options.sidecarUrl?.() ?? voiceSidecarBaseUrl()

  const label = () => {
    if (!active()) return ""
    if (phase() === "hearing") {
      const text = hearing().trim()
      if (text) return `Voice · hearing: ${text}`
      return "Voice · listening… (/voice to stop)"
    }
    if (phase() === "listening") return "Voice · listening… (/voice to stop)"
    if (phase() === "working") return "Voice · working…"
    if (phase() === "speaking") return "Voice · speaking…"
    if (phase() === "awaiting_reply") return "Voice · want more detail?"
    return "Voice · starting…"
  }

  const clearPartialTimer = () => {
    if (!partialTimer) return
    clearTimeout(partialTimer)
    partialTimer = undefined
  }

  const resetConversation = () => {
    clearPartialTimer()
    clearAckTimer()
    partialText = ""
    conversationPhase = "listening"
    fullReplyText = ""
    spokenSoFar = ""
    pendingOffer = false
    lastSpoken = ""
    lastSubmitted = ""
    micCooldownUntil = 0
    setAwaitingSpeak(false)
  }

  const setDisplayPhase = (next: TuiVoicePhase) => {
    if (!active()) return
    setPhase(next)
  }

  const setMicEnabled = (enabled: boolean) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    voiceLogStage("STATE", `mic ${enabled ? "on" : "off"}`)
    ws.send(JSON.stringify({ type: "mic", enabled }))
  }

  const resumeMicAfterPlayback = (spokenText = lastSpoken, onResume?: () => void) => {
    const cooldown = Math.max(1500, 600 + spokenText.length * 35)
    micCooldownUntil = Date.now() + cooldown
    setTimeout(() => {
      if (ttsActive || speakInFlight) return
      onResume?.()
      syncMic()
    }, cooldown)
  }

  const finishSpeaking = (spokenText = lastSpoken) => {
    ttsActive = false
    if (!speakInFlight) resumeMicAfterPlayback(spokenText)
    if (conversationPhase === "awaiting_reply") {
      setDisplayPhase("awaiting_reply")
      return
    }
    if (conversationPhase === "awaiting_agent" && options.working()) {
      setDisplayPhase("working")
      return
    }
    setDisplayPhase("listening")
  }

  const stopSpeaking = () => {
    playGeneration++
    stopMp3()
    ttsActive = false
    if (!speakInFlight) resumeMicAfterPlayback()
    if (conversationPhase === "awaiting_reply") {
      setDisplayPhase("awaiting_reply")
      return
    }
    if (conversationPhase === "awaiting_agent" && options.working()) {
      setDisplayPhase("working")
      return
    }
    setDisplayPhase("listening")
  }

  const speakText = async (text: string, raw = false) => {
    if (!text.trim() || !running) {
      voiceLogStage("TTS", `skip empty=${!text.trim()} running=${running}`)
      return
    }
    const generation = playGeneration
    ttsActive = true
    setMicEnabled(false)
    micCooldownUntil = Date.now() + 500
    setDisplayPhase("speaking")
    voiceLogStage("TTS", `fetch ${text.length} chars raw=${raw} sidecar=${sidecar()}`)
    try {
      const result = await fetchVoiceSpeak({ sidecarUrl: sidecar(), text, raw })
      if (generation !== playGeneration || !running) {
        voiceLogStage("TTS", "abort stale generation after fetch")
        return
      }
      const bytes = base64ToBytes(result.data)
      voiceLogStage("TTS", `play ${bytes.length} bytes format=${result.format}`)
      await playMp3(bytes)
      voiceLogStage("TTS", "play done")
    } catch (error) {
      if (generation !== playGeneration) return
      const message = error instanceof Error ? error.message : "voice speak failed"
      voiceLogStage("TTS", `error ${message}`)
      options.onError(message)
    }
    if (generation !== playGeneration) return
    finishSpeaking(text)
  }

  const speakParts = async (texts: string[], raw = false) => {
    for (const text of texts) {
      if (!running) return
      if (!text.trim()) continue
      await speakText(text, raw)
    }
  }

  const canAcceptSpeech = () => micOpen() && conversationPhase === "listening"

  const schedulePartialFinal = (text: string) => {
    if (!canAcceptSpeech()) return
    partialText = text
    clearPartialTimer()
    partialTimer = setTimeout(() => {
      if (!partialText.trim() || partialText !== text) return
      if (ttsActive) return
      if (Date.now() < micCooldownUntil) return
      if (!canAcceptSpeech()) return
      clearPartialTimer()
      setHearing("")
      handleSpeechFinal(partialText)
      partialText = ""
    }, 1200)
  }

  const deciderPhase = () => {
    if (conversationPhase === "awaiting_reply") return "awaiting_reply"
    if (ttsActive) return "speaking"
    if (conversationPhase === "awaiting_agent" || options.working()) return "working"
    return "listening"
  }

  const submitVoiceTurn = (text: string) => {
    voiceLogResetOnce()
    lastSubmitted = text.trim()
    voiceLogStage("STATE", `submit ${text.length} chars preview="${text.slice(0, 40)}"`)
    setMicEnabled(false)
    options.submitTranscript(text)
    setAwaitingSpeak(true)
    conversationPhase = "awaiting_agent"
    startAckTimer()
  }

  const handleMidTurnSpeech = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    try {
      const result = await fetchVoiceDecide({
        sidecarUrl: sidecar(),
        text: trimmed,
        phase: deciderPhase(),
        pendingOffer: pendingOffer && conversationPhase === "awaiting_reply",
        lastSpoken,
        progress: options.progressSnapshot?.(),
      })

      if (result.intent === "stop") {
        stopSpeaking()
        return
      }

      if (result.intent === "status" && result.speak) {
        await speakText(result.speak, true)
        lastSpoken = result.speak
        return
      }

      if (result.intent === "reply") {
        if (result.reply === "no") {
          pendingOffer = false
          conversationPhase = "listening"
          if (result.speak) await speakText(result.speak, true)
          return
        }
        if (result.reply === "yes" && fullReplyText) {
          const chunk = await fetchVoiceContinuationChunk({
            sidecarUrl: sidecar(),
            fullText: fullReplyText,
            spokenSoFar,
          })
          spokenSoFar = `${spokenSoFar} ${chunk.chunk}`.trim()
          lastSpoken = chunk.chunk
          const parts = [chunk.chunk]
          if (chunk.offer && !chunk.done) {
            parts.push(chunk.offer)
            pendingOffer = true
            conversationPhase = "awaiting_reply"
          } else {
            pendingOffer = false
            conversationPhase = "listening"
          }
          await speakParts(parts, true)
          return
        }
      }

      if (result.intent === "redirect") {
        if (looksLikeAssistantEcho(trimmed)) return
        resetConversation()
        submitVoiceTurn(trimmed)
      }
    } catch (error) {
      options.onError(error instanceof Error ? error.message : "voice decide failed")
    }
  }

  const handleSpeechFinal = (text: string) => {
    if (!text.trim()) return
    if (ttsActive || speakInFlight) {
      if (wantsStopSpeech(text)) stopSpeaking()
      return
    }
    if (Date.now() < micCooldownUntil) return
    if (looksLikeAssistantEcho(text)) {
      voiceLogStage("STATE", `echo-drop "${text.slice(0, 40)}"`)
      return
    }
    if (textEchoesSpoken(text, lastSubmitted)) return
    if (conversationPhase === "awaiting_agent") return
    if (canAcceptSpeech()) {
      submitVoiceTurn(text)
      return
    }
    void handleMidTurnSpeech(text)
  }

  const handleEvent = (event: ReturnType<typeof parseVoiceSidecarEvent>) => {
    if (!event) return
    if (event.type === "ready") {
      setDisplayPhase("listening")
      return
    }
    if (event.type === "transcript") {
      if (ttsActive || speakInFlight || conversationPhase === "awaiting_agent" || Date.now() < micCooldownUntil) {
        if (event.speechFinal) {
          voiceLogStage("STATE", `transcript-blocked final "${event.text.slice(0, 40)}"`)
        }
        return
      }
      if (event.text.trim() && !event.speechFinal) {
        voiceLogStage("STATE", `transcript-partial "${event.text.slice(0, 40)}"`)
        setHearing(event.text)
        if (canAcceptSpeech()) {
          setDisplayPhase("hearing")
          options.onTranscript?.(event.text)
        }
        schedulePartialFinal(event.text)
      }
      if (event.speechFinal) {
        voiceLogStage("STATE", `transcript-final "${event.text.slice(0, 60)}"`)
        clearPartialTimer()
        partialText = ""
        setHearing("")
        handleSpeechFinal(event.text)
      }
      return
    }
    if (event.type === "status") {
      if (event.state === "listening" && !ttsActive) {
        if (conversationPhase === "awaiting_reply") setDisplayPhase("awaiting_reply")
        else if (!options.working()) {
          if (hearing().trim() && canAcceptSpeech()) setDisplayPhase("hearing")
          else setDisplayPhase("listening")
        }
      }
      if (options.working()) setDisplayPhase("working")
      return
    }
    if (event.type === "error") {
      if (ttsActive) finishSpeaking()
      options.onError(event.message)
    }
  }

  const speakAssistantReply = async (reply: string) => {
    if (!reply.trim() || speakInFlight) {
      voiceLogStage("TTS", `reply-skip empty=${!reply.trim()} inFlight=${speakInFlight}`)
      return
    }
    speakInFlight = true
    clearAckTimer()
    setAwaitingSpeak(false)
    setMicEnabled(false)
    voiceLogStage("TTS", `reply-start ${reply.length} chars preview="${reply.slice(0, 60)}"`)
    try {
      const plan = await fetchVoiceFinalSpeak({ sidecarUrl: sidecar(), text: reply })
      voiceLogStage("TTS", `plan parts=${plan.parts.length} offer=${plan.hasOffer}`)
      fullReplyText = plan.fullText || reply
      spokenSoFar = plan.parts.join(" ").trim()
      lastSpoken = spokenSoFar
      pendingOffer = plan.hasOffer
      await speakParts(plan.parts, true)
      pendingOffer = plan.hasOffer
      voiceLogStage("TTS", "reply-done")
      resumeMicAfterPlayback(spokenSoFar, () => {
        conversationPhase = plan.hasOffer ? "awaiting_reply" : "listening"
        if (plan.hasOffer) setDisplayPhase("awaiting_reply")
        else setDisplayPhase("listening")
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "voice speak failed"
      voiceLogStage("TTS", `plan-error ${message} — fallback direct speak`)
      options.onError(message)
      lastSpoken = reply
      await speakText(reply, true)
      resumeMicAfterPlayback(reply, () => {
        conversationPhase = "listening"
        setDisplayPhase("listening")
      })
    } finally {
      speakInFlight = false
    }
  }

  let lastSpeakWaitKey = ""

  createEffect(() => {
    if (!active() || !awaitingSpeak()) return
    if (options.working()) {
      setDisplayPhase("working")
      const waitKey = `working:${conversationPhase}`
      if (waitKey !== lastSpeakWaitKey) {
        lastSpeakWaitKey = waitKey
        voiceLogStage("STATE", `awaitingSpeak working phase=${conversationPhase}`)
      }
    }
  })

  const stop = () => {
    voiceLogStage("STATE", "stop")
    running = false
    playGeneration++
    stopMp3()
    ttsActive = false
    speakInFlight = false
    micCooldownUntil = 0
    resetConversation()
    setHearing("")
    clearPartialTimer()
    if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    ws = undefined
    setActive(false)
    setPhase("off")
  }

  const start = async () => {
    if (running) return
    const sessionID = options.sessionID()
    if (!sessionID) throw new Error("no active session")

    speakInFlight = false
    micCooldownUntil = 0
    conversationPhase = "listening"

    const session = await createVoiceSidecarSession({
      sidecarUrl: sidecar(),
      directory: options.directory(),
      sessionID,
      agent: options.agent(),
      server: voiceControlPlaneUrl({ url: options.opencodeUrl(), serverUrl: options.serverUrl?.() }),
      terminalMic: true,
    })

    running = true
    setActive(true)
    voiceLogStage("STATE", `start session=${sessionID} sidecar=${sidecar()}`)
    setDisplayPhase("listening")

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(session.stream)
      ws = socket
      socket.onopen = () => {
        setMicEnabled(true)
        resolve()
      }
      socket.onerror = () => reject(new Error("voice stream connection failed"))
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return
        handleEvent(parseVoiceSidecarEvent(message.data))
      }
      socket.onclose = () => {
        if (running) options.onError("voice stream closed")
        stop()
      }
    })
  }

  const toggle = () => {
    if (active()) {
      stop()
      return
    }
    if (!process.env.XAI_API_KEY?.trim()) {
      options.onError("XAI_API_KEY is not set")
      return
    }
    void start().catch((error) => {
      options.onError(error instanceof Error ? error.message : "voice failed")
      stop()
    })
  }

  onCleanup(() => stop())

  return {
    active,
    phase,
    label,
    debug,
    toggle,
    stop,
    awaitingSpeak,
    speakAssistantReply,
  }
}
