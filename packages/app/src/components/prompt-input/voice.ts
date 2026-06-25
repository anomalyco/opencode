import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { createVoiceRuntime, type VoiceRuntimeOptions } from "./voice-runtime"
import {
  fetchVoiceAck,
  fetchVoiceContinuationChunk,
  fetchVoiceDecide,
  fetchVoiceFinalSpeak,
  fetchVoiceSpeak,
  type VoiceContinuationChunk,
  type VoiceProgressSnapshot,
} from "./voice-api"
import {
  applyVoiceQuestionAnswer,
  createVoiceQuestionState,
  parsePermissionReply,
  permissionPromptSpeech,
  questionPromptSpeech,
  questionSummarySpeech,
  rejectSpeech,
  type VoicePermissionReply,
  type VoiceQuestionState,
} from "./voice-panel"
import { initVoiceLog, setVoiceLogEnabled, voiceLogLines, voiceLogResetOnce, voiceLogStage } from "./voice-log"

export { voiceSidecarBaseUrl } from "./voice-sidecar"

export type VoicePhase = "listening" | "hearing" | "transcribing" | "speaking"

export type VoiceDisplayState =
  | "off"
  | VoicePhase
  | "working"
  | "awaiting_reply"
  | "continuing"
  | "awaiting_question"
  | "awaiting_permission"

type ConversationPhase =
  | "listening"
  | "awaiting_agent"
  | "awaiting_reply"
  | "continuing"
  | "awaiting_question"
  | "awaiting_permission"

const ACK_DELAY_MS = 3000
const ACK_RETRY_MS = 4000
const MIC_TAIL_MS = 700
const LISTEN_PARTIAL_MS = 1200
const ECHO_GUARD_MS = 2500
const CONTINUATION_ACK = "One moment."

function normalizeSpokenComparison(text: string) {
  return normalizeVoiceText(text)
    .replace(/\bopen code\b/g, "opencode")
    .replace(/\bdegrees?\b/g, " ")
    .replace(/\bfahrenheit\b/g, " f ")
    .replace(/\bf\b/g, " f ")
    .replace(/\bcelsius\b/g, " c ")
    .replace(/\s+/g, " ")
    .trim()
}

function textEchoesSpoken(input: string, spoken: string, strict = false) {
  const left = normalizeVoiceText(input)
  const right = normalizeVoiceText(spoken)
  if (!left || !right) return false
  if (left === right) return true
  if (!strict) return false
  if (left.length >= 8 && right.includes(left)) return true
  if (right.length >= 8 && left.includes(right)) return true
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (shorter.length >= 12 && longer.includes(shorter)) return true
  return false
}

function wordOverlapEcho(input: string, spoken: string) {
  const leftWords = normalizeVoiceText(input)
    .split(" ")
    .filter((word) => word.length > 2)
  const rightWords = new Set(
    normalizeVoiceText(spoken)
      .split(" ")
      .filter((word) => word.length > 2),
  )
  if (leftWords.length === 0 || rightWords.size === 0) return false
  const overlap = leftWords.filter((word) => rightWords.has(word)).length
  return overlap / leftWords.length >= 0.55
}

function echoesSpokenText(input: string, spoken: string) {
  if (!spoken.trim()) return false
  if (textEchoesSpoken(input, spoken, true)) return true
  if (wordOverlapEcho(input, spoken)) return true
  const left = normalizeSpokenComparison(input)
  const right = normalizeSpokenComparison(spoken)
  if (!left || !right) return false
  if (left === right) return true
  if (left.length >= 6 && right.length >= 6 && (left.includes(right) || right.includes(left))) return true
  const leftNumber = left.match(/^(\d+)/)?.[1]
  const rightNumber = right.match(/^(\d+)/)?.[1]
  if (!leftNumber || leftNumber !== rightNumber) return false
  const leftTail = left.slice(leftNumber.length).trim()
  const rightTail = right.slice(rightNumber.length).trim()
  if (!leftTail || !rightTail) return true
  if (/^(f|c|fahrenheit|celsius)$/.test(leftTail) || /^(f|c|fahrenheit|celsius)$/.test(rightTail)) return true
  return wordOverlapEcho(leftTail, rightTail)
}

function echoesPriorSubmission(input: string, submitted: string) {
  if (!submitted.trim()) return false
  const current = normalizeVoiceText(input)
  const prior = normalizeVoiceText(submitted)
  if (!current || !prior) return false
  if (current === prior) return true
  if (!textEchoesSpoken(input, submitted, true)) {
    if (prior.split(" ").length < 4) return false
    return wordOverlapEcho(input, submitted)
  }
  const shorter = current.length <= prior.length ? current : prior
  const longer = current.length <= prior.length ? prior : current
  if (shorter.length >= 10 && longer.includes(shorter)) {
    if (shorter.split(" ").length >= 3) return true
    if (shorter.length >= longer.length * 0.65) return true
  }
  if (prior.split(" ").length >= 4) return wordOverlapEcho(input, submitted)
  return false
}

function wantsStopSpeech(text: string) {
  const lowered = text.trim().toLowerCase()
  if (/^(stop|cancel|quiet|enough|wait|halt|shush|silence)\b/.test(lowered)) return true
  return (
    /\b(stop|cancel|quiet|enough|hold on|wait|never mind|nevermind)\b/.test(lowered) ||
    /\b(no more|not anymore|that's enough|thats enough|be quiet|shut up)\b/.test(lowered) ||
    /\bstop (this|that|it|talking|speaking)\b/.test(lowered)
  )
}

function normalizeVoiceText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
}

function looksLikeNewCommand(text: string) {
  const normalized = normalizeVoiceText(text)
  if (normalized.split(" ").length < 3) return false
  if (/^(yes|no|yeah|nope|stop|cancel|hello|hi|hey|thanks)\b/.test(normalized)) return false
  return true
}

function stripTrailingOfferEcho(text: string) {
  const idx = text.lastIndexOf("?")
  if (idx < 0 || idx >= text.length - 1) return text.trim()
  const after = text.slice(idx + 1).trim()
  return after || text.trim()
}

function parseOfferReply(text: string): "yes" | "no" | undefined {
  const normalized = normalizeVoiceText(stripTrailingOfferEcho(text))
  if (!normalized) return undefined
  if (/^(should i|want me to|would you like)\b/.test(normalized) && !/^(yes|no)\b/.test(normalized)) {
    return undefined
  }
  if (
    /^(yes|yeah|yep|yup|sure|please|ok|okay|alright|all right|go ahead|absolutely|definitely|of course|why not|do it)\b/.test(
      normalized,
    )
  ) {
    return "yes"
  }
  if (/\b(tell me more|more detail|more details|keep going|go on|continue)\b/.test(normalized)) {
    return "yes"
  }
  if (/^(no|nope|nah)\b/.test(normalized)) return "no"
  if (/\b(that s good|that s fine|that s enough|im good|i m good|we re good|skip it|never mind|nevermind)\b/.test(normalized)) {
    return "no"
  }
  if (/\b(give me more|can you give me more)\b/.test(normalized)) return "yes"
  if (/\b(is not|i m not|not really|no thanks|no thank you)\b/.test(normalized)) return "no"
  if (/\bnot$/.test(normalized) && normalized.split(" ").length <= 6) return "no"
  if (/\bno\b/.test(normalized) && normalized.split(" ").length <= 5) return "no"
  return undefined
}

function affirmativeActionPrompt(closing: string) {
  let body = closing.replace(/\?$/, "").trim()
  const lower = body.toLowerCase()
  for (const prefix of ["want me to ", "should i ", "would you like me to ", "do you want me to "]) {
    if (lower.startsWith(prefix)) {
      body = body.slice(prefix.length).trim()
      break
    }
  }
  if (!body) return "Yes."
  return `Yes. ${body.charAt(0).toUpperCase()}${body.slice(1)}.`
}

function looksLikePhantomSpeech(text: string) {
  const normalized = normalizeVoiceText(text)
  if (!normalized) return true
  const words = normalized.split(" ")
  if (words.length === 1) {
    return /^(there|theres|the|a|an|uh|um|oh|so|it|its|is|are|was|and|but|or|if|in|on|at|to|of|for|as|by|up|do|be|he|she|we|they|you|i|my|your|this|that|what|when|where|how|why|who|no|not|yes|ok|okay)$/.test(
      normalized,
    )
  }
  if (words.length <= 3 && normalized.startsWith("there") && normalized.length <= 16) return true
  return false
}

const statusKey: Record<VoiceDisplayState, string> = {
  off: "prompt.voice.status.off",
  listening: "prompt.voice.status.listening",
  hearing: "prompt.voice.status.hearing",
  transcribing: "prompt.voice.status.transcribing",
  working: "prompt.voice.status.working",
  speaking: "prompt.voice.status.speaking",
  awaiting_reply: "prompt.voice.status.awaitingReply",
  continuing: "prompt.voice.status.continuing",
  awaiting_question: "prompt.voice.status.awaitingQuestion",
  awaiting_permission: "prompt.voice.status.awaitingPermission",
}

export function voiceStatusKey(state: VoiceDisplayState) {
  return statusKey[state]
}

function disclosureDismissed() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem("opencode.voice.disclosure") === "1"
}

export type VoiceConnectOptions = Omit<
  VoiceRuntimeOptions,
  "setPhase" | "onError" | "onSpeechFinal" | "onTranscript"
> & {
  onError: (message: string) => void
  onTranscript?: (text: string) => void
  onSpeechFinal?: (text: string) => void
  onRedirect?: (text: string) => void
  assistantReplyForVoiceTurn?: () => string | undefined
  progressSnapshot?: () => VoiceProgressSnapshot | undefined
  pendingQuestion?: () => QuestionRequest | undefined
  pendingPermission?: () => PermissionRequest | undefined
  replyQuestion?: (input: { requestID: string; answers: QuestionAnswer[] }) => void
  rejectQuestion?: (input: { requestID: string }) => void
  replyPermission?: (input: { requestID: string; reply: VoicePermissionReply }) => void
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
  const [hearingText, setHearingText] = createSignal("")
  const [conversationPhase, setConversationPhase] = createSignal<ConversationPhase>("listening")
  let ackTimer: ReturnType<typeof setTimeout> | undefined
  let fullReplyText = ""
  let spokenSoFar = ""
  let pendingOffer = false
  let offerListening = false
  let offerHandling = false
  let prefetchedContinuationKey = ""
  let prefetchedContinuation: VoiceContinuationChunk | undefined
  const ttsEncodings = new Map<string, Promise<string>>()
  let lastSpoken = ""
  let lastSubmitted = ""
  let closingQuestion = ""
  let actionOffer = false
  let questionState: VoiceQuestionState | undefined
  let lastQuestionRequestID = ""
  let lastPermissionRequestID = ""
  let panelPromptSpoken = ""
  let speakInFlight = false
  let speakGeneration = 0
  let lastTtsEndedAt = 0
  let userListenOpen = true
  let micTailTimer: ReturnType<typeof setTimeout> | undefined
  let voicePreviewActive = false
  let offerPartialText = ""
  let offerPartialTimer: ReturnType<typeof setTimeout> | undefined
  let listenPartialText = ""
  let listenPartialTimer: ReturnType<typeof setTimeout> | undefined

  const isAssistantSpeaking = () => !!runtime?.speaking() || speakInFlight

  const spokenEchoSources = () => [lastSpoken, spokenSoFar, fullReplyText].filter((text) => text.trim())

  const echoesRecentAssistantSpeech = (text: string) =>
    spokenEchoSources().some((source) => echoesSpokenText(text, source))

  const userListenWindowOpen = () => store.on && userListenOpen && !isAssistantSpeaking()

  const admitUserTranscript = (text: string) => {
    if (wantsStopSpeech(text)) return true
    if (offerListening && parseOfferReply(text)) return true
    if (!userListenWindowOpen()) return false
    if (Date.now() - lastTtsEndedAt < ECHO_GUARD_MS && echoesRecentAssistantSpeech(text)) return false
    return true
  }

  const looksLikeAssistantEcho = (text: string) => {
    if (isAssistantSpeaking()) return true
    if (Date.now() - lastTtsEndedAt >= ECHO_GUARD_MS) return false
    return echoesRecentAssistantSpeech(text)
  }

  const canFillPrompt = () =>
    userListenWindowOpen() &&
    conversationPhase() === "listening" &&
    !options.working() &&
    !speakInFlight &&
    !pendingOffer

  const awaitingOfferReply = () => conversationPhase() === "awaiting_reply" && pendingOffer

  const clearListenPartialTimer = () => {
    if (!listenPartialTimer) return
    clearTimeout(listenPartialTimer)
    listenPartialTimer = undefined
  }

  const clearOfferPartialTimer = () => {
    if (!offerPartialTimer) return
    clearTimeout(offerPartialTimer)
    offerPartialTimer = undefined
  }

  const clearMicTailTimer = () => {
    if (!micTailTimer) return
    clearTimeout(micTailTimer)
    micTailTimer = undefined
  }

  const openUserListen = () => {
    userListenOpen = true
    runtime?.setMicSend(true)
  }

  const armUserListenClosed = () => {
    clearMicTailTimer()
    userListenOpen = false
    runtime?.setMicSend(false)
  }

  const scheduleUserListen = () => {
    clearMicTailTimer()
    userListenOpen = false
    micTailTimer = setTimeout(() => {
      micTailTimer = undefined
      if (!store.on || isAssistantSpeaking()) return
      openUserListen()
    }, MIC_TAIL_MS)
  }

  const exitSpokenFlow = () => {
    voiceLogStage("STATE", "exit-spoken-flow")
    speakGeneration++
    runtime?.stopSpeaking()
    pendingOffer = false
    offerListening = false
    offerHandling = false
    offerPartialText = ""
    listenPartialText = ""
    clearOfferPartialTimer()
    clearListenPartialTimer()
    clearContinuationPrefetch()
    if (conversationPhase() === "awaiting_reply" || conversationPhase() === "continuing") {
      setConversationPhase("listening")
    }
  }

  const tryStopSpeech = (text: string) => {
    if (!wantsStopSpeech(text)) return false
    exitSpokenFlow()
    return true
  }

  const handleOfferWaitSpeech = (text: string) => {
    if (!awaitingOfferReply()) return false
    if (tryStopSpeech(text)) return true
    if (offerListening && tryHandleOfferReply(text)) return true
    if (looksLikeAssistantEcho(text)) return true
    return true
  }

  const clearVoicePreview = () => {
    if (!voicePreviewActive) {
      setHearingText("")
      if (store.phase === "hearing") setStore("phase", "listening")
      return
    }
    voicePreviewActive = false
    setHearingText("")
    if (store.phase === "hearing") setStore("phase", "listening")
    options.connect?.onTranscript?.("")
  }

  const canPreviewTranscript = (text: string, speechFinal: boolean) => {
    if (!text.trim()) return false
    if (awaitingOfferReply()) return false
    if (!speechFinal) {
      if (tryHandleOfferReply(text)) return false
      if (handleOfferWaitSpeech(text)) return false
      if (tryHandlePanelSpeech(text)) return false
      if (!admitUserTranscript(text)) return false
      if (looksLikePhantomSpeech(text) && !awaitingOfferReply() && !panelPending()) return false
    }
    if (isAssistantSpeaking()) return false
    if (looksLikeAssistantEcho(text) && !awaitingOfferReply()) return false
    if (conversationPhase() !== "listening") return false
    if (options.working()) return false
    return userListenWindowOpen()
  }

  const shouldAcceptSpeechFinal = (text: string) => {
    if (!admitUserTranscript(text)) return false
    return canFillPrompt()
  }

  const submitVoiceTurn = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (looksLikePhantomSpeech(trimmed)) {
      voiceLogStage("STATE", `submit-phantom-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (looksLikeAssistantEcho(trimmed)) {
      voiceLogStage("STATE", `submit-echo-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (conversationPhase() === "listening" && echoesPriorSubmission(trimmed, lastSubmitted)) {
      voiceLogStage("STATE", `submit-prior-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (conversationPhase() === "listening" && echoesSpokenText(trimmed, lastSpoken)) {
      voiceLogStage("STATE", `submit-spoken-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (!looksLikeNewCommand(trimmed)) {
      voiceLogStage("STATE", `submit-short-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (!shouldAcceptSpeechFinal(trimmed)) {
      voiceLogStage("STATE", `submit-admission-block "${trimmed.slice(0, 40)}"`)
      return
    }
    voiceLogResetOnce()
    voiceLogStage("STATE", `submit ${trimmed.length} chars preview="${trimmed.slice(0, 40)}"`)
    clearVoicePreview()
    lastSubmitted = trimmed
    options.connect?.onSpeechFinal?.(trimmed)
    setAwaitingSpeak(true)
    setConversationPhase("awaiting_agent")
    startAckTimer()
  }

  const scheduleListenPartialFinal = (text: string) => {
    if (!canFillPrompt()) return
    listenPartialText = text
    clearListenPartialTimer()
    listenPartialTimer = setTimeout(() => {
      if (!listenPartialText.trim() || listenPartialText !== text) return
      clearListenPartialTimer()
      submitVoiceTurn(listenPartialText)
      listenPartialText = ""
    }, LISTEN_PARTIAL_MS)
  }

  const sidecar = () => options.connect?.sidecarUrl

  const panelPending = () => !!options.connect?.pendingQuestion?.() || !!options.connect?.pendingPermission?.()

  const display = createMemo((): VoiceDisplayState => {
    if (!store.on) return "off"
    if (store.phase === "speaking") return "speaking"
    if (conversationPhase() === "continuing") return "continuing"
    if (conversationPhase() === "awaiting_reply" && offerListening && !isAssistantSpeaking()) return "awaiting_reply"
    if (conversationPhase() === "awaiting_question") return "awaiting_question"
    if (conversationPhase() === "awaiting_permission") return "awaiting_permission"
    if (options.working() && !panelPending()) return "working"
    return store.phase
  })

  const statusHeader = createMemo(() => {
    if (conversationPhase() !== "awaiting_question") return undefined
    return questionState?.questions[questionState.tab]?.header
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
    offerListening = false
    offerHandling = false
    prefetchedContinuationKey = ""
    prefetchedContinuation = undefined
    ttsEncodings.clear()
    questionState = undefined
    voicePreviewActive = false
    offerPartialText = ""
    listenPartialText = ""
    clearOfferPartialTimer()
    clearListenPartialTimer()
    lastQuestionRequestID = ""
    lastPermissionRequestID = ""
    panelPromptSpoken = ""
    lastSpoken = ""
    lastSubmitted = ""
    closingQuestion = ""
    actionOffer = false
    speakInFlight = false
    lastTtsEndedAt = 0
    userListenOpen = true
    clearMicTailTimer()
    setHearingText("")
  }

  const syncPanelState = () => {
    const permission = options.connect?.pendingPermission?.()
    if (permission) {
      clearAckTimer()
      if (permission.id !== lastPermissionRequestID) {
        lastPermissionRequestID = permission.id
        lastQuestionRequestID = ""
        questionState = undefined
        setConversationPhase("awaiting_permission")
        const key = `permission:${permission.id}`
        if (panelPromptSpoken !== key) {
          panelPromptSpoken = key
          void runtime?.speak(permissionPromptSpeech())
        }
      }
      return
    }
    lastPermissionRequestID = ""

    const request = options.connect?.pendingQuestion?.()
    if (!request) {
      const phase = conversationPhase()
      if (phase === "awaiting_question" || phase === "awaiting_permission") {
        setConversationPhase(options.working() ? "awaiting_agent" : "listening")
      }
      questionState = undefined
      lastQuestionRequestID = ""
      return
    }

    clearAckTimer()
    if (request.id !== lastQuestionRequestID) {
      voiceLogStage("STATE", `question-start id=${request.id} count=${request.questions.length}`)
      runtime?.stopSpeaking()
      speakGeneration++
      speakInFlight = false
      setAwaitingSpeak(false)
      questionState = createVoiceQuestionState({ requestID: request.id, questions: request.questions })
      lastQuestionRequestID = request.id
      setConversationPhase("awaiting_question")
      panelPromptSpoken = ""
    }

    if (!questionState) return
    const key = `question:${request.id}:${questionState.phase}:${questionState.tab}`
    if (panelPromptSpoken === key) return
    panelPromptSpoken = key
    const prompt = questionPromptSpeech(questionState)
    if (!prompt.trim()) return
    voiceLogStage("TTS", `panel-prompt phase=${questionState.phase} tab=${questionState.tab} "${prompt.slice(0, 60)}"`)
    void runtime?.speak(prompt)
  }

  const tryHandlePanelSpeech = (text: string) => {
    syncPanelState()
    const permission = options.connect?.pendingPermission?.()
    if (permission) {
      const reply = parsePermissionReply(text)
      if (!reply) return false
      options.connect?.replyPermission?.({ requestID: permission.id, reply })
      setConversationPhase(options.working() ? "awaiting_agent" : "listening")
      return true
    }

    const request = options.connect?.pendingQuestion?.()
    if (!request || !questionState) return false
    if (rejectSpeech(text)) {
      voiceLogStage("STATE", "question-reject")
      options.connect?.rejectQuestion?.({ requestID: request.id })
      questionState = undefined
      lastQuestionRequestID = ""
      setConversationPhase(options.working() ? "awaiting_agent" : "listening")
      return true
    }
    const action = applyVoiceQuestionAnswer(questionState, text)
    if (action.type === "none") return false
    if (action.type === "reject") {
      voiceLogStage("STATE", "question-reject-action")
      options.connect?.rejectQuestion?.({ requestID: request.id })
      questionState = undefined
      lastQuestionRequestID = ""
      setConversationPhase(options.working() ? "awaiting_agent" : "listening")
      return true
    }
    if (action.type === "summary") {
      questionState = action.state
      voiceLogStage("STATE", "question-summary")
      void runtime?.speak(questionSummarySpeech(questionState))
      return true
    }
    if (action.type === "advance") {
      questionState = action.state
      voiceLogStage("STATE", `question-advance phase=${questionState.phase} tab=${questionState.tab}`)
      setConversationPhase("awaiting_question")
      panelPromptSpoken = ""
      if (action.speakAfter) {
        void runtime?.speak(action.speakAfter).then(() => syncPanelState())
      } else {
        syncPanelState()
      }
      return true
    }
    options.connect?.replyQuestion?.({ requestID: request.id, answers: action.answers })
    voiceLogStage("STATE", "question-reply")
    questionState = undefined
    lastQuestionRequestID = ""
    setConversationPhase(options.working() ? "awaiting_agent" : "listening")
    return true
  }

  const continuationCacheKey = () => `${fullReplyText.trim()}::${spokenSoFar.trim()}`

  const clearContinuationPrefetch = () => {
    prefetchedContinuationKey = ""
    prefetchedContinuation = undefined
  }

  const ttsCacheKey = (text: string, raw: boolean) => `${raw ? "r" : "s"}:${text.trim()}`

  const prefetchTts = (text: string, raw = true) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const key = ttsCacheKey(trimmed, raw)
    if (ttsEncodings.has(key)) return
    ttsEncodings.set(
      key,
      fetchVoiceSpeak({ sidecarUrl: sidecar(), text: trimmed, raw })
        .then((result) => result.data)
        .catch((error) => {
          ttsEncodings.delete(key)
          throw error
        }),
    )
  }

  const loadTts = (text: string, raw = true) => {
    const trimmed = text.trim()
    const key = ttsCacheKey(trimmed, raw)
    const pending = ttsEncodings.get(key)
    if (pending) {
      ttsEncodings.delete(key)
      return pending
    }
    return fetchVoiceSpeak({ sidecarUrl: sidecar(), text: trimmed, raw }).then((result) => result.data)
  }

  const closingUnspoken = (question: string) => {
    const trimmed = question.trim()
    if (!trimmed) return false
    return !echoesSpokenText(trimmed, spokenSoFar) && !echoesSpokenText(trimmed, lastSpoken)
  }

  const speakPlan = async (
    texts: string[],
    input: { raw?: boolean; offerAtEnd?: boolean; shouldContinue?: () => boolean; beforeLastPart?: () => void },
  ) =>
    runtime?.speakPlanParts(texts, {
      raw: input.raw ?? true,
      offerAtEnd: input.offerAtEnd,
      shouldContinue: input.shouldContinue,
      beforeLastPart: input.beforeLastPart,
      loadTts,
    })

  const prefetchNextContinuation = () => {
    if (!fullReplyText.trim()) return
    const key = continuationCacheKey()
    if (prefetchedContinuationKey === key && prefetchedContinuation) return
    prefetchedContinuationKey = key
    prefetchedContinuation = undefined
    void fetchVoiceContinuationChunk({
      sidecarUrl: sidecar(),
      fullText: fullReplyText,
      spokenSoFar,
    })
      .then((chunk) => {
        if (prefetchedContinuationKey !== key) return
        prefetchedContinuation = chunk
        if (chunk.chunk?.trim()) prefetchTts(chunk.chunk, true)
        if (chunk.offer?.trim()) prefetchTts(chunk.offer, true)
      })
      .catch(() => {
        if (prefetchedContinuationKey === key) prefetchedContinuationKey = ""
      })
  }

  const loadContinuationChunk = () => {
    const key = continuationCacheKey()
    if (prefetchedContinuation && prefetchedContinuationKey === key) {
      const chunk = prefetchedContinuation
      clearContinuationPrefetch()
      return Promise.resolve(chunk)
    }
    clearContinuationPrefetch()
    return fetchVoiceContinuationChunk({
      sidecarUrl: sidecar(),
      fullText: fullReplyText,
      spokenSoFar,
    })
  }

  const loadContinuationChunkWithRetry = async () => {
    const chunk = await loadContinuationChunk()
    if (chunk.chunk?.trim() || chunk.done) return chunk
    clearContinuationPrefetch()
    return fetchVoiceContinuationChunk({
      sidecarUrl: sidecar(),
      fullText: fullReplyText,
      spokenSoFar,
    })
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
    if (panelPending()) return
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
    const phase = conversationPhase()
    if (phase === "awaiting_question" || phase === "awaiting_permission") return "awaiting_reply"
    if (phase === "awaiting_reply" || phase === "continuing") return "awaiting_reply"
    if (store.phase === "speaking" || runtime?.speaking() || speakInFlight) return "speaking"
    if (phase === "awaiting_agent" || options.working()) return "working"
    return "listening"
  }

  const tryHandleOfferReply = (text: string) => {
    if (!pendingOffer || !offerListening || offerHandling) return false
    if (isAssistantSpeaking()) return false
    const reply = parseOfferReply(text)
    if (!reply) return false
    voiceLogStage("STATE", `offer-reply ${reply} "${text.slice(0, 40)}"`)
    void handleOfferReply(reply)
    return true
  }

  const scheduleOfferReplyPartial = (text: string) => {
    if (!offerListening || !pendingOffer) return
    offerPartialText = text
    clearOfferPartialTimer()
    offerPartialTimer = setTimeout(() => {
      if (!offerPartialText.trim() || offerPartialText !== text) return
      clearOfferPartialTimer()
      clearVoicePreview()
      if (tryHandleOfferReply(offerPartialText)) offerPartialText = ""
    }, MIC_TAIL_MS)
  }

  const handleOfferReply = async (reply: "yes" | "no") => {
    if (offerHandling) return
    offerHandling = true
    speakGeneration++
    pendingOffer = false
    offerListening = false
    offerPartialText = ""
    clearOfferPartialTimer()
    clearVoicePreview()
    runtime?.stopSpeaking()
    try {
      if (reply === "no") {
        voiceLogStage("STATE", "offer-decline")
        clearContinuationPrefetch()
        setConversationPhase("listening")
        return
      }
      if (actionOffer && closingQuestion.trim()) {
        voiceLogStage("STATE", `offer-action-yes "${closingQuestion.slice(0, 60)}"`)
        clearContinuationPrefetch()
        setConversationPhase("listening")
        submitVoiceTurn(affirmativeActionPrompt(closingQuestion))
        return
      }
      if (!fullReplyText) {
        setConversationPhase("listening")
        return
      }
      setConversationPhase("continuing")
      voiceLogStage("TTS", "offer-continue")
      speakInFlight = true
      armUserListenClosed()
      const generation = speakGeneration
      try {
        const chunk = await loadContinuationChunkWithRetry()
        if (generation !== speakGeneration) return
        await speakPlan([CONTINUATION_ACK], {
          shouldContinue: () => generation === speakGeneration,
        })
        if (generation !== speakGeneration) return
        if (!chunk.chunk?.trim() && !chunk.done) {
          setConversationPhase("listening")
          return
        }
        if (chunk.done) {
          const tail = chunk.chunk?.trim() || chunk.closingQuestion?.trim() || closingQuestion.trim()
          if (tail && closingUnspoken(tail)) {
            spokenSoFar = `${spokenSoFar} ${tail}`.trim()
            lastSpoken = tail
            prefetchTts(tail, true)
            await speakPlan([tail], { shouldContinue: () => generation === speakGeneration })
          }
          setConversationPhase("listening")
          return
        }
        spokenSoFar = `${spokenSoFar} ${chunk.chunk}`.trim()
        lastSpoken = chunk.chunk
        const parts = [chunk.chunk]
        const offerAtEnd = !!chunk.offer
        if (chunk.offer) parts.push(chunk.offer)
        if (offerAtEnd) {
          pendingOffer = true
          offerListening = false
          setConversationPhase("awaiting_reply")
          prefetchNextContinuation()
        }
        for (const part of parts) {
          if (part?.trim()) prefetchTts(part, true)
        }
        await speakPlan(parts, {
          offerAtEnd,
          shouldContinue: () => generation === speakGeneration,
          beforeLastPart:
            offerAtEnd && parts.length > 1
              ? () => {
                  pendingOffer = true
                  offerListening = true
                  setConversationPhase("awaiting_reply")
                  prefetchNextContinuation()
                }
              : undefined,
        })
        if (!pendingOffer) setConversationPhase("listening")
      } finally {
        speakInFlight = false
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "voice offer reply failed"
      voiceLogStage("STATE", `offer-error ${message}`)
      options.connect?.onError(message)
      setConversationPhase("listening")
    } finally {
      offerHandling = false
    }
  }

  const handleMidTurnSpeech = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (looksLikePhantomSpeech(trimmed) && !awaitingOfferReply()) return

    try {
      const result = await fetchVoiceDecide({
        sidecarUrl: options.connect?.sidecarUrl,
        text: trimmed,
        phase: deciderPhase(),
        pendingOffer: pendingOffer && offerListening,
        lastSpoken,
        progress: options.connect?.progressSnapshot?.(),
      })

      if (result.intent === "stop") {
        exitSpokenFlow()
        return
      }

      if (result.intent === "status" && result.speak) {
        await runtime?.speakParts([result.speak])
        lastSpoken = result.speak
        return
      }

      if (result.intent === "reply") {
        if ((result.reply === "no" || result.reply === "yes") && !offerListening) return
        if (result.reply === "no" || result.reply === "yes") {
          void handleOfferReply(result.reply)
          return
        }
      }

      if (result.intent === "redirect") {
        if (looksLikePhantomSpeech(trimmed) || looksLikeAssistantEcho(trimmed)) return
        if (!looksLikeNewCommand(trimmed)) {
          voiceLogStage("STATE", `redirect-skip-short "${trimmed.slice(0, 40)}"`)
          return
        }
        voiceLogStage("STATE", `redirect "${trimmed.slice(0, 40)}"`)
        runtime?.stopSpeaking()
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
    if (!store.on) return
    options.connect?.pendingQuestion?.()
    options.connect?.pendingPermission?.()
    syncPanelState()
  })

  createEffect(() => {
    if (!store.on || !awaitingSpeak()) return
    if (options.working()) return
    if (panelPending()) return

    clearAckTimer()

    const reply = options.connect?.assistantReplyForVoiceTurn?.()
    if (!reply?.trim()) return

    setAwaitingSpeak(false)

    void fetchVoiceFinalSpeak({ sidecarUrl: options.connect?.sidecarUrl, text: reply })
      .then(async (plan) => {
        voiceLogStage("TTS", `plan parts=${plan.parts.length} offer=${plan.hasOffer} action=${plan.actionOffer ?? false}`)
        fullReplyText = plan.fullText || reply
        spokenSoFar =
          plan.hasOffer && plan.parts.length > 1 ? plan.parts.slice(0, -1).join(" ").trim() : plan.parts.join(" ").trim()
        lastSpoken = spokenSoFar
        closingQuestion = plan.closingQuestion?.trim() ?? ""
        actionOffer = !!plan.actionOffer && !!closingQuestion
        clearVoicePreview()
        speakInFlight = true
        armUserListenClosed()
        const generation = speakGeneration
        if (plan.hasOffer && plan.parts.length > 1) {
          pendingOffer = true
          offerListening = false
          setConversationPhase("awaiting_reply")
        } else {
          pendingOffer = false
          offerListening = false
          setConversationPhase("listening")
        }
        try {
          if (plan.hasOffer && plan.parts.length > 1) {
            for (const part of plan.parts) {
              if (part?.trim()) prefetchTts(part, true)
            }
            prefetchNextContinuation()
          } else {
            for (const part of plan.parts) {
              if (part?.trim()) prefetchTts(part, true)
            }
          }
          await speakPlan(plan.parts, {
            offerAtEnd: plan.hasOffer,
            shouldContinue: () => generation === speakGeneration,
            beforeLastPart:
              plan.hasOffer && plan.parts.length > 1
                ? () => {
                    pendingOffer = true
                    offerListening = true
                    setConversationPhase("awaiting_reply")
                    prefetchNextContinuation()
                  }
                : undefined,
          })
          if (!pendingOffer) setConversationPhase("listening")
          voiceLogStage("TTS", "reply-done")
        } finally {
          speakInFlight = false
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "voice speak failed"
        voiceLogStage("TTS", `plan-error ${message}`)
        options.connect?.onError(message)
        void runtime?.speak(reply)
        setConversationPhase("listening")
      })
  })

  const toggle = () => {
    if (store.on) {
      voiceLogStage("STATE", "stop")
      setVoiceLogEnabled(false)
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

    initVoiceLog({
      sidecarUrl: options.connect.sidecarUrl,
      active: () => store.on,
    })
    setVoiceLogEnabled(true)
    voiceLogStage("STATE", `start session=${options.connect.sessionID()} sidecar=${options.connect.sidecarUrl?.() ?? ""}`)

    runtime = createVoiceRuntime({
      sidecarUrl: options.connect.sidecarUrl,
      opencodeUrl: options.connect.opencodeUrl,
      directory: options.connect.directory,
      sessionID: options.connect.sessionID,
      agent: options.connect.agent,
      onTranscript: (text, input) => {
        if (tryStopSpeech(text)) {
          clearVoicePreview()
          return
        }
        if (awaitingOfferReply()) {
          if (!input.speechFinal && offerListening && parseOfferReply(text)) scheduleOfferReplyPartial(text)
          if (handleOfferWaitSpeech(text)) {
            clearVoicePreview()
            return
          }
        }
        if (!canPreviewTranscript(text, input.speechFinal)) {
          clearVoicePreview()
          return
        }
        if (!input.speechFinal) {
          setHearingText(text.trim())
          setStore("phase", "hearing")
          if (!canFillPrompt()) return
          voicePreviewActive = true
          options.connect!.onTranscript?.(text)
          scheduleListenPartialFinal(text)
          return
        }
      },
      onSpeechFinal: (text) => {
        clearVoicePreview()
        clearListenPartialTimer()
        listenPartialText = ""
        if (!text.trim()) return
        if (tryStopSpeech(text)) return

        if (awaitingOfferReply()) {
          if (offerListening && tryHandleOfferReply(text)) return
          if (handleOfferWaitSpeech(text)) {
            voiceLogStage("STATE", `offer-wait-ignore "${text.slice(0, 40)}"`)
            return
          }
          if (speakInFlight || !offerListening) void handleMidTurnSpeech(text)
          return
        }

        if (!admitUserTranscript(text)) {
          voiceLogStage("STATE", `transcript-admission-drop "${text.slice(0, 40)}"`)
          return
        }
        if (looksLikePhantomSpeech(text) && !panelPending()) {
          voiceLogStage("STATE", `phantom-drop "${text.slice(0, 40)}"`)
          return
        }
        if (tryHandlePanelSpeech(text)) return
        if (offerHandling) return
        if (panelPending()) return
        if (runtime?.speaking()) {
          void handleMidTurnSpeech(text)
          return
        }
        if (conversationPhase() === "listening") {
          submitVoiceTurn(text)
          return
        }
        void handleMidTurnSpeech(text)
      },
      onTtsActiveChange: (active) => {
        if (active) armUserListenClosed()
        else {
          lastTtsEndedAt = Date.now()
          scheduleUserListen()
        }
      },
      setPhase: (phase) => setStore("phase", phase),
      onError: (message) => {
        voiceLogStage("STATE", `error ${message}`)
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
    statusHeader,
    hearingText,
    voiceLogLines: () => voiceLogLines(),
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
  if (state === "continuing") return "ring-1 ring-inset ring-icon-info-active/50"
  if (state === "awaiting_question" || state === "awaiting_permission") {
    return "ring-1 ring-inset ring-icon-info-active/50"
  }
  return "ring-1 ring-inset ring-border-base/80"
}
