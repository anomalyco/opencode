import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createVoiceRuntime, type VoiceRuntimeOptions } from "./voice-runtime"
import {
  fetchVoiceAck,
  fetchVoiceContinuationChunk,
  fetchVoiceDecide,
  fetchVoiceFinalSpeak,
  type VoiceProgressSnapshot,
} from "./voice-api"

export { voiceSidecarBaseUrl } from "./voice-sidecar"

export type VoicePhase = "listening" | "hearing" | "transcribing" | "speaking"

export type VoiceDisplayState = "off" | VoicePhase | "working" | "awaiting_reply"

type ConversationPhase = "listening" | "awaiting_agent" | "awaiting_reply"

const ACK_DELAY_MS = 3000
const ACK_RETRY_MS = 4000

const statusKey: Record<VoiceDisplayState, string> = {
  off: "prompt.voice.status.off",
  listening: "prompt.voice.status.listening",
  hearing: "prompt.voice.status.hearing",
  transcribing: "prompt.voice.status.transcribing",
  working: "prompt.voice.status.working",
  speaking: "prompt.voice.status.speaking",
  awaiting_reply: "prompt.voice.status.awaitingReply",
}

export function voiceStatusKey(state: VoiceDisplayState) {
  return statusKey[state]
}

function disclosureDismissed() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem("opencode.voice.disclosure") === "1"
}

export type VoiceConnectOptions = Omit<VoiceRuntimeOptions, "setPhase" | "onError" | "onSpeechFinal"> & {
  onError: (message: string) => void
  onSpeechFinal?: (text: string) => void
  onRedirect?: (text: string) => void
  assistantReplyForVoiceTurn?: () => string | undefined
  progressSnapshot?: () => VoiceProgressSnapshot | undefined
}

export function createVoiceComposerState(options: { working: () => boolean; connect?: VoiceConnectOptions }) {
  const [store, setStore] = createStore({
    on: false,
    phase: "listening" as VoicePhase,
    showDisclosure: false,
    disclosureDismissed: disclosureDismissed(),
    connecting: false,
  })

  let runtime: ReturnType<typeof createVoiceRuntime> | undefined
  const [awaitingSpeak, setAwaitingSpeak] = createSignal(false)
  const [conversationPhase, setConversationPhase] = createSignal<ConversationPhase>("listening")
  let ackTimer: ReturnType<typeof setTimeout> | undefined
  let fullReplyText = ""
  let spokenSoFar = ""
  let pendingOffer = false
  let lastSpoken = ""
  let lastSubmitted = ""

  const display = createMemo((): VoiceDisplayState => {
    if (!store.on) return "off"
    if (conversationPhase() === "awaiting_reply" && store.phase === "listening") return "awaiting_reply"
    if (store.phase === "speaking") return "speaking"
    if (options.working()) return "working"
    return store.phase
  })

  const active = createMemo(() => display() !== "off")

  const clearAckTimer = () => {
    if (!ackTimer) return
    clearTimeout(ackTimer)
    ackTimer = undefined
  }

  const resetConversation = () => {
    clearAckTimer()
    setConversationPhase("listening")
    fullReplyText = ""
    spokenSoFar = ""
    pendingOffer = false
    lastSpoken = ""
    lastSubmitted = ""
  }

  const stopRuntime = () => {
    runtime?.stop()
    runtime = undefined
    setAwaitingSpeak(false)
    resetConversation()
    setStore("connecting", false)
  }

  const maybePlayAck = (query: string, retry: boolean) => {
    if (conversationPhase() !== "awaiting_agent") return
    if (!options.working()) return
    void fetchVoiceAck({
      sidecarUrl: options.connect?.sidecarUrl,
      text: query,
      progress: options.connect?.progressSnapshot?.(),
    })
      .then((ack) => {
        if (conversationPhase() !== "awaiting_agent") return
        if (!options.working()) return
        if (ack.skip) {
          if (!retry) {
            ackTimer = setTimeout(() => maybePlayAck(query, true), ACK_RETRY_MS)
          }
          return
        }
        if (!ack.text?.trim()) return
        void runtime?.speak(ack.text)
      })
      .catch((error) => {
        options.connect?.onError(error instanceof Error ? error.message : "voice ack failed")
      })
  }

  const startAckTimer = () => {
    clearAckTimer()
    const query = lastSubmitted
    if (!query.trim()) return
    ackTimer = setTimeout(() => maybePlayAck(query, false), ACK_DELAY_MS)
  }

  const deciderPhase = () => {
    if (conversationPhase() === "awaiting_reply") return "awaiting_reply"
    if (store.phase === "speaking" || runtime?.speaking()) return "speaking"
    if (conversationPhase() === "awaiting_agent" || options.working()) return "working"
    return "listening"
  }

  const handleMidTurnSpeech = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    try {
      const result = await fetchVoiceDecide({
        sidecarUrl: options.connect?.sidecarUrl,
        text: trimmed,
        phase: deciderPhase(),
        pendingOffer: pendingOffer && conversationPhase() === "awaiting_reply",
        lastSpoken,
        progress: options.connect?.progressSnapshot?.(),
      })

      if (result.intent === "stop") {
        runtime?.stopSpeaking()
        return
      }

      if (result.intent === "status" && result.speak) {
        await runtime?.speakParts([result.speak])
        lastSpoken = result.speak
        return
      }

      if (result.intent === "reply") {
        if (result.reply === "no") {
          pendingOffer = false
          setConversationPhase("listening")
          if (result.speak) await runtime?.speakParts([result.speak])
          return
        }
        if (result.reply === "yes" && fullReplyText) {
          const chunk = await fetchVoiceContinuationChunk({
            sidecarUrl: options.connect?.sidecarUrl,
            fullText: fullReplyText,
            spokenSoFar,
          })
          spokenSoFar = `${spokenSoFar} ${chunk.chunk}`.trim()
          lastSpoken = chunk.chunk
          const parts = [chunk.chunk]
          if (chunk.offer && !chunk.done) {
            parts.push(chunk.offer)
            pendingOffer = true
            setConversationPhase("awaiting_reply")
          } else {
            pendingOffer = false
            setConversationPhase("listening")
          }
          await runtime?.speakParts(parts)
          return
        }
      }

      if (result.intent === "redirect") {
        resetConversation()
        lastSubmitted = trimmed
        options.connect?.onRedirect?.(trimmed)
        setAwaitingSpeak(true)
        startAckTimer()
        setConversationPhase("awaiting_agent")
      }
    } catch (error) {
      options.connect?.onError(error instanceof Error ? error.message : "voice decide failed")
    }
  }

  createEffect(() => {
    if (!store.on || !awaitingSpeak()) return
    if (options.working()) return

    clearAckTimer()

    const reply = options.connect?.assistantReplyForVoiceTurn?.()
    if (!reply?.trim()) return

    setAwaitingSpeak(false)

    void fetchVoiceFinalSpeak({ sidecarUrl: options.connect?.sidecarUrl, text: reply })
      .then(async (plan) => {
        fullReplyText = plan.fullText || reply
        spokenSoFar = plan.parts.join(" ").trim()
        lastSpoken = spokenSoFar
        pendingOffer = plan.hasOffer
        if (plan.hasOffer) setConversationPhase("awaiting_reply")
        await runtime?.speakParts(plan.parts)
        if (!plan.hasOffer) setConversationPhase("listening")
      })
      .catch((error) => {
        options.connect?.onError(error instanceof Error ? error.message : "voice speak failed")
        void runtime?.speak(reply)
        setConversationPhase("listening")
      })
  })

  const toggle = () => {
    if (store.on) {
      stopRuntime()
      setStore({ on: false, phase: "listening", showDisclosure: false })
      return
    }
    setStore({ on: true, phase: "listening" })
    if (!store.disclosureDismissed) setStore("showDisclosure", true)

    if (!options.connect) return

    if (!options.connect.sessionID()) {
      options.connect.onError("prompt.voice.error.noSession")
      setStore("on", false)
      return
    }

    runtime = createVoiceRuntime({
      sidecarUrl: options.connect.sidecarUrl,
      opencodeUrl: options.connect.opencodeUrl,
      directory: options.connect.directory,
      sessionID: options.connect.sessionID,
      agent: options.connect.agent,
      onTranscript: options.connect.onTranscript,
      onSpeechFinal: (text) => {
        if (!text.trim()) return
        if (conversationPhase() === "listening") {
          lastSubmitted = text.trim()
          options.connect?.onSpeechFinal?.(text)
          setAwaitingSpeak(true)
          setConversationPhase("awaiting_agent")
          startAckTimer()
          return
        }
        void handleMidTurnSpeech(text)
      },
      setPhase: (phase) => setStore("phase", phase),
      onError: (message) => {
        options.connect!.onError(message)
        const fatal =
          message === "voice stream closed" ||
          message === "voice stream connection failed" ||
          message.startsWith("prompt.voice.error.")
        if (!fatal) return
        stopRuntime()
        setStore({ on: false, phase: "listening" })
      },
    })
    setStore("connecting", true)
    void runtime
      .start()
      .catch((error) => {
        options.connect!.onError(error instanceof Error ? error.message : "voice failed")
        stopRuntime()
        setStore({ on: false, phase: "listening" })
      })
      .finally(() => setStore("connecting", false))
  }

  onCleanup(() => stopRuntime())

  return {
    store,
    display,
    active,
    toggle,
    dismissDisclosure: () => {
      if (typeof localStorage !== "undefined") localStorage.setItem("opencode.voice.disclosure", "1")
      setStore({ showDisclosure: false, disclosureDismissed: true })
    },
    setPhase: (phase: VoicePhase) => setStore("phase", phase),
  }
}

export type VoiceComposerState = ReturnType<typeof createVoiceComposerState>

export function voiceComposerBorderClass(state: VoiceDisplayState) {
  if (state === "off") return ""
  if (state === "hearing" || state === "speaking") return "ring-1 ring-inset ring-icon-info-active/60"
  if (state === "working") return "ring-1 ring-inset ring-icon-interactive-base/40"
  if (state === "awaiting_reply") return "ring-1 ring-inset ring-icon-info-active/40"
  return "ring-1 ring-inset ring-border-base/80"
}
