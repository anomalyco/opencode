import { createEffect, createSignal, onCleanup } from "solid-js"
import {
  fetchVoiceAck,
  fetchVoiceContinuationChunk,
  fetchVoiceDecide,
  fetchVoiceFinalSpeak,
  fetchVoiceSpeak,
  type VoiceContinuationChunk,
  type VoiceProgressSnapshot,
} from "./api"
import { setVoiceLogListener, voiceLog, voiceLogResetOnce, voiceLogStage } from "./log"
import { playMp3, stopMp3, voiceSidecarBaseUrl } from "./play"
import { createVoiceSidecarSession, parseVoiceSidecarEvent } from "./sidecar"
import { voiceControlPlaneUrl } from "./url"
import {
  applyVoiceQuestionAnswer,
  createVoiceQuestionState,
  parsePermissionReply,
  permissionPromptSpeech,
  questionPromptSpeech,
  questionSummarySpeech,
  rejectSpeech,
  type VoiceQuestionState,
} from "./panel"
import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"

export type TuiVoicePhase =
  | "off"
  | "listening"
  | "hearing"
  | "working"
  | "speaking"
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

const CONTINUATION_ACK = "One moment."

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
  interruptAgent?: () => void
  pendingQuestion?: () => QuestionRequest | undefined
  pendingPermission?: () => PermissionRequest | undefined
  replyQuestion?: (input: { requestID: string; answers: QuestionAnswer[] }) => void
  rejectQuestion?: (input: { requestID: string }) => void
  replyPermission?: (input: { requestID: string; reply: "once" | "always" | "reject" }) => void
  onError: (message: string) => void
}

function base64ToBytes(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function normalizeVoiceText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

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
  return wantsInterruptAgent(text)
}

function wantsInterruptAgent(text: string) {
  const lowered = text.trim().toLowerCase()
  if (/^(stop|cancel|quiet|enough|wait|halt|shush|silence)\b/.test(lowered)) return true
  return (
    /\b(stop|cancel|interrupt|halt|abort|quit|quiet|enough|hold on|wait|never mind|nevermind)\b/.test(
      lowered,
    ) ||
    /\b(no more|not anymore|that's enough|thats enough|be quiet|shut up)\b/.test(lowered) ||
    /\bstop (this|that|it|talking|speaking)\b/.test(lowered)
  )
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
  if (/\b(that s fine|that s enough|im good|i m good|we re good|skip it|never mind|nevermind)\b/.test(normalized)) {
    return "no"
  }
  if (/\b(is not|i m not|not really|no thanks|no thank you)\b/.test(normalized)) return "no"
  if (/\bnot$/.test(normalized) && normalized.split(" ").length <= 6) return "no"
  if (/\bno\b/.test(normalized) && normalized.split(" ").length <= 5) return "no"
  return undefined
}

const ACK_DELAY_MS = 3000
const ACK_RETRY_MS = 4000
const ACK_POLL_MS = 12000
const MIC_TAIL_MS = 700
const ECHO_GUARD_MS = 2500
const OFFER_DECLINE_IGNORE_MS = 5000

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
  let closingQuestion = ""
  let actionOffer = false
  let pendingOffer = false
  let lastSpoken = ""
  let ttsActive = false
  let playGeneration = 0
  let partialText = ""
  let partialTimer: ReturnType<typeof setTimeout> | undefined
  let lastSubmitted = ""
  let ackTimer: ReturnType<typeof setTimeout> | undefined
  let ackPlayedCount = 0
  let speakInFlight = false
  let offerHandling = false
  let offerDeclinedAt = 0
  let prefetchedContinuationKey = ""
  let prefetchedContinuation: VoiceContinuationChunk | undefined
  let prefetchedSpeakText = ""
  let prefetchedSpeakBytes: Uint8Array | undefined
  let prefetchedOfferText = ""
  let prefetchedOfferBytes: Uint8Array | undefined
  let questionState: VoiceQuestionState | undefined
  let lastQuestionRequestID = ""
  let lastPermissionRequestID = ""
  let panelPromptSpoken = ""
  let lastTtsEndedAt = 0
  let lastSpokenAt = 0
  let userListenOpen = true
  let micTailTimer: ReturnType<typeof setTimeout> | undefined

  const isAssistantSpeaking = () => ttsActive || speakInFlight

  const spokenEchoSources = () => [lastSpoken, spokenSoFar, fullReplyText].filter((text) => text.trim())

  const echoesRecentAssistantSpeech = (text: string) =>
    spokenEchoSources().some((source) => echoesSpokenText(text, source))

  const bypassUserAdmission = (text: string) => wantsStopSpeech(text) || wantsInterruptAgent(text)

  const userListenWindowOpen = () => running && userListenOpen && !isAssistantSpeaking()

  const admitUserTranscript = (text: string) => {
    if (bypassUserAdmission(text)) return true
    if (!userListenWindowOpen()) return false
    if (Date.now() - lastTtsEndedAt < ECHO_GUARD_MS && echoesRecentAssistantSpeech(text)) return false
    return true
  }

  const looksLikeAssistantEcho = (text: string) => {
    if (wantsInterruptAgent(text)) return false
    if (isAssistantSpeaking()) return true
    if (Date.now() - lastTtsEndedAt >= ECHO_GUARD_MS) return false
    return echoesRecentAssistantSpeech(text)
  }

  const canFillPrompt = () =>
    userListenWindowOpen() && conversationPhase === "listening" && !options.working()

  const showUserHearing = (text: string) => {
    setHearing(text)
    setDisplayPhase("hearing")
  }

  const clearMicTailTimer = () => {
    if (!micTailTimer) return
    clearTimeout(micTailTimer)
    micTailTimer = undefined
  }

  const armUserListenClosed = () => {
    clearMicTailTimer()
    userListenOpen = false
    voiceLogStage("STATE", "user-listen closed")
  }

  const openUserListen = () => {
    userListenOpen = true
    voiceLogStage("STATE", "user-listen open")
  }

  const scheduleUserListen = () => {
    clearMicTailTimer()
    userListenOpen = false
    micTailTimer = setTimeout(() => {
      micTailTimer = undefined
      if (!running || isAssistantSpeaking()) return
      openUserListen()
    }, MIC_TAIL_MS)
  }

  const syncMic = () => {
    if (!running) return
    setMicEnabled(true)
  }

  const clearAckTimer = () => {
    if (!ackTimer) return
    clearTimeout(ackTimer)
    ackTimer = undefined
  }

  const scheduleAckPoll = (query: string, delay: number) => {
    clearAckTimer()
    if (conversationPhase !== "awaiting_agent") return
    ackTimer = setTimeout(() => maybePlayAck(query, false), delay)
  }

  const maybePlayAck = (query: string, retry: boolean) => {
    if (conversationPhase !== "awaiting_agent") return
    if (panelPending()) return
    if (!options.working()) return
    voiceLogStage("TTS", `ack-check retry=${retry} played=${ackPlayedCount}`)
    void fetchVoiceAck({
      sidecarUrl: sidecar(),
      text: query,
      progress: options.progressSnapshot?.(),
      periodic: ackPlayedCount > 0,
    })
      .then(async (ack) => {
        if (!running) return
        if (conversationPhase !== "awaiting_agent") return
        if (!options.working()) return
        if (ack.skip) {
          voiceLogStage("TTS", "ack-skip")
          scheduleAckPoll(query, retry ? ACK_POLL_MS : ACK_RETRY_MS)
          return
        }
        if (!ack.text?.trim()) {
          scheduleAckPoll(query, ACK_POLL_MS)
          return
        }
        voiceLogStage("TTS", `ack-play "${ack.text.slice(0, 40)}"`)
        ackPlayedCount++
        lastSpoken = ack.text
        await speakText(ack.text, true)
        if (conversationPhase === "awaiting_agent" && options.working()) {
          scheduleAckPoll(query, ACK_POLL_MS)
        }
      })
      .catch((error) => {
        options.onError(error instanceof Error ? error.message : "voice ack failed")
        if (conversationPhase === "awaiting_agent" && options.working()) {
          scheduleAckPoll(query, ACK_POLL_MS)
        }
      })
  }

  const startAckTimer = () => {
    ackPlayedCount = 0
    const query = lastSubmitted
    if (!query.trim()) return
    scheduleAckPoll(query, ACK_DELAY_MS)
  }

  const interruptAgentTurn = () => {
    voiceLogStage("STATE", "interrupt-agent")
    options.interruptAgent?.()
    stopSpeaking()
    clearAckTimer()
    ackPlayedCount = 0
    setAwaitingSpeak(false)
    conversationPhase = "listening"
    setDisplayPhase("listening")
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
    if (phase() === "awaiting_reply") return "Voice · say yes or no"
    if (phase() === "continuing") return "Voice · continuing…"
    if (phase() === "awaiting_question") {
      const header = questionState?.questions[questionState.tab]?.header
      if (header) return `Voice · pick: ${header}`
      return "Voice · say an option"
    }
    if (phase() === "awaiting_permission") return "Voice · say allow or reject"
    return "Voice · starting…"
  }

  const clearPartialTimer = () => {
    if (!partialTimer) return
    clearTimeout(partialTimer)
    partialTimer = undefined
  }

  const resetConversation = () => {
    clearPartialTimer()
    clearMicTailTimer()
    clearAckTimer()
    partialText = ""
    conversationPhase = "listening"
    fullReplyText = ""
    spokenSoFar = ""
    pendingOffer = false
    offerHandling = false
    offerDeclinedAt = 0
    prefetchedContinuationKey = ""
    prefetchedContinuation = undefined
    prefetchedSpeakText = ""
    prefetchedSpeakBytes = undefined
    prefetchedOfferText = ""
    prefetchedOfferBytes = undefined
    questionState = undefined
    lastQuestionRequestID = ""
    lastPermissionRequestID = ""
    panelPromptSpoken = ""
    lastSpoken = ""
    lastSubmitted = ""
    userListenOpen = true
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

  const panelPending = () => !!options.pendingQuestion?.() || !!options.pendingPermission?.()

  const restorePhaseAfterSpeech = () => {
    if (conversationPhase === "awaiting_question") {
      setDisplayPhase("awaiting_question")
      return
    }
    if (conversationPhase === "awaiting_permission") {
      setDisplayPhase("awaiting_permission")
      return
    }
    if (conversationPhase === "continuing") {
      setDisplayPhase("continuing")
      return
    }
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

  const finishSpeaking = () => {
    ttsActive = false
    lastTtsEndedAt = Date.now()
    scheduleUserListen()
    restorePhaseAfterSpeech()
  }

  const stopSpeaking = () => {
    playGeneration++
    stopMp3()
    ttsActive = false
    speakInFlight = false
    lastTtsEndedAt = Date.now()
    scheduleUserListen()
    restorePhaseAfterSpeech()
  }

  const syncPanelState = () => {
    const permission = options.pendingPermission?.()
    if (permission) {
      clearAckTimer()
      if (permission.id !== lastPermissionRequestID) {
        lastPermissionRequestID = permission.id
        lastQuestionRequestID = ""
        questionState = undefined
        conversationPhase = "awaiting_permission"
        setDisplayPhase("awaiting_permission")
        const key = `permission:${permission.id}`
        if (panelPromptSpoken !== key) {
          panelPromptSpoken = key
          void speakText(permissionPromptSpeech(), true)
        }
      }
      return
    }
    lastPermissionRequestID = ""

    const request = options.pendingQuestion?.()
    if (!request) {
      if (conversationPhase === "awaiting_question" || conversationPhase === "awaiting_permission") {
        conversationPhase = options.working() ? "awaiting_agent" : "listening"
        restorePhaseAfterSpeech()
      }
      questionState = undefined
      lastQuestionRequestID = ""
      return
    }

    clearAckTimer()
    if (request.id !== lastQuestionRequestID) {
      stopSpeaking()
      speakInFlight = false
      setAwaitingSpeak(false)
      questionState = createVoiceQuestionState({ requestID: request.id, questions: request.questions })
      lastQuestionRequestID = request.id
      conversationPhase = "awaiting_question"
      setDisplayPhase("awaiting_question")
      panelPromptSpoken = ""
    }

    if (!questionState) return
    const key = `question:${request.id}:${questionState.phase}:${questionState.tab}`
    if (panelPromptSpoken === key) return
    panelPromptSpoken = key
    const prompt = questionPromptSpeech(questionState)
    if (!prompt.trim()) return
    void speakText(prompt, true)
  }

  const tryHandlePanelSpeech = (text: string) => {
    syncPanelState()
    const permission = options.pendingPermission?.()
    if (permission) {
      const reply = parsePermissionReply(text)
      if (!reply) return false
      voiceLogStage("STATE", `permission-reply ${reply}`)
      options.replyPermission?.({ requestID: permission.id, reply })
      conversationPhase = options.working() ? "awaiting_agent" : "listening"
      restorePhaseAfterSpeech()
      return true
    }

    const request = options.pendingQuestion?.()
    if (!request || !questionState) return false
    if (rejectSpeech(text)) {
      voiceLogStage("STATE", "question-reject")
      options.rejectQuestion?.({ requestID: request.id })
      questionState = undefined
      lastQuestionRequestID = ""
      conversationPhase = options.working() ? "awaiting_agent" : "listening"
      restorePhaseAfterSpeech()
      return true
    }
    const action = applyVoiceQuestionAnswer(questionState, text)
    if (action.type === "none") return false
    if (action.type === "reject") {
      voiceLogStage("STATE", "question-reject")
      options.rejectQuestion?.({ requestID: request.id })
      questionState = undefined
      lastQuestionRequestID = ""
      conversationPhase = options.working() ? "awaiting_agent" : "listening"
      restorePhaseAfterSpeech()
      return true
    }
    if (action.type === "summary") {
      questionState = action.state
      void speakText(questionSummarySpeech(questionState), true)
      return true
    }
    if (action.type === "advance") {
      questionState = action.state
      conversationPhase = "awaiting_question"
      setDisplayPhase("awaiting_question")
      panelPromptSpoken = ""
      if (action.speakAfter) {
        void speakText(action.speakAfter, true).then(() => syncPanelState())
      } else {
        syncPanelState()
      }
      voiceLogStage("STATE", `question-advance tab=${questionState.tab}`)
      return true
    }
    voiceLogStage("STATE", "question-reply")
    options.replyQuestion?.({ requestID: request.id, answers: action.answers })
    questionState = undefined
    lastQuestionRequestID = ""
    conversationPhase = options.working() ? "awaiting_agent" : "listening"
    restorePhaseAfterSpeech()
    return true
  }

  function rejectSpeech(text: string) {
    const normalized = normalizeVoiceText(text)
    return /^(no|nope|cancel|reject|stop|skip|never mind|nevermind)\b/.test(normalized)
  }

  const continuationCacheKey = () => `${fullReplyText.trim()}::${spokenSoFar.trim()}`

  const clearContinuationPrefetch = () => {
    prefetchedContinuationKey = ""
    prefetchedContinuation = undefined
    prefetchedSpeakText = ""
    prefetchedSpeakBytes = undefined
    prefetchedOfferText = ""
    prefetchedOfferBytes = undefined
  }

  const prefetchOfferBytes = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    prefetchedOfferText = trimmed
    prefetchedOfferBytes = undefined
    void fetchVoiceSpeak({ sidecarUrl: sidecar(), text: trimmed, raw: true })
      .then((result) => {
        if (prefetchedOfferText !== trimmed) return
        prefetchedOfferBytes = base64ToBytes(result.data)
        voiceLogStage("TTS", `offer-prefetch-ready ${trimmed.length} chars`)
      })
      .catch(() => {})
  }

  const consumePrefetchedOfferBytes = (text: string) => {
    const trimmed = text.trim()
    if (prefetchedOfferText !== trimmed || !prefetchedOfferBytes) return undefined
    const bytes = prefetchedOfferBytes
    prefetchedOfferText = ""
    prefetchedOfferBytes = undefined
    voiceLogStage("TTS", "offer-prefetch-hit")
    return bytes
  }

  const prefetchSpeakBytes = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    prefetchedSpeakText = trimmed
    prefetchedSpeakBytes = undefined
    void fetchVoiceSpeak({ sidecarUrl: sidecar(), text: trimmed, raw: true })
      .then((result) => {
        if (prefetchedSpeakText !== trimmed) return
        prefetchedSpeakBytes = base64ToBytes(result.data)
        voiceLogStage("TTS", `speak-prefetch-ready ${trimmed.length} chars`)
      })
      .catch(() => {})
  }

  const consumePrefetchedSpeakBytes = (text: string) => {
    const trimmed = text.trim()
    if (prefetchedSpeakText !== trimmed || !prefetchedSpeakBytes) return undefined
    const bytes = prefetchedSpeakBytes
    prefetchedSpeakText = ""
    prefetchedSpeakBytes = undefined
    voiceLogStage("TTS", "speak-prefetch-hit")
    return bytes
  }

  const prefetchNextContinuation = () => {
    if (!fullReplyText.trim()) return
    const key = continuationCacheKey()
    if (prefetchedContinuationKey === key && prefetchedContinuation) return
    prefetchedContinuationKey = key
    prefetchedContinuation = undefined
    prefetchedSpeakText = ""
    prefetchedSpeakBytes = undefined
    voiceLogStage("STATE", "continuation-prefetch-start")
    void fetchVoiceContinuationChunk({
      sidecarUrl: sidecar(),
      fullText: fullReplyText,
      spokenSoFar,
    })
      .then((chunk) => {
        if (prefetchedContinuationKey !== key) return
        prefetchedContinuation = chunk
        voiceLogStage("STATE", "continuation-prefetch-ready")
        if (chunk.chunk?.trim()) prefetchSpeakBytes(chunk.chunk)
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
      voiceLogStage("STATE", "continuation-prefetch-hit")
      return Promise.resolve(chunk)
    }
    clearContinuationPrefetch()
    voiceLogStage("STATE", "continuation-prefetch-miss")
    return fetchVoiceContinuationChunk({
      sidecarUrl: sidecar(),
      fullText: fullReplyText,
      spokenSoFar,
    })
  }

  const exitSpokenFlow = () => {
    stopSpeaking()
    pendingOffer = false
    offerHandling = false
    clearContinuationPrefetch()
    clearPartialTimer()
    partialText = ""
    setHearing("")
    if (conversationPhase === "awaiting_reply" || conversationPhase === "continuing") {
      conversationPhase = "listening"
      setDisplayPhase("listening")
    }
  }

  const tryStopSpeech = (text: string, partial: boolean) => {
    if (!wantsStopSpeech(text)) return false
    voiceLogStage("STATE", `${partial ? "barge-stop-partial" : "barge-stop"} "${text.slice(0, 40)}"`)
    if (conversationPhase === "awaiting_agent" && options.working()) {
      interruptAgentTurn()
      return true
    }
    exitSpokenFlow()
    return true
  }

  const tryInterruptAgent = (text: string, partial: boolean) => {
    if (!wantsInterruptAgent(text)) return false
    if (options.working()) {
      voiceLogStage("STATE", `${partial ? "interrupt-partial" : "interrupt"} "${text.slice(0, 40)}"`)
      interruptAgentTurn()
      return true
    }
    if (!isSpeaking() && conversationPhase !== "continuing" && conversationPhase !== "awaiting_reply") {
      return false
    }
    voiceLogStage("STATE", `${partial ? "interrupt-partial" : "interrupt"} "${text.slice(0, 40)}"`)
    exitSpokenFlow()
    return true
  }

  const speakText = async (text: string, raw = false, audioBytes?: Uint8Array) => {
    if (!text.trim() || !running) {
      voiceLogStage("TTS", `skip empty=${!text.trim()} running=${running}`)
      return
    }
    const generation = playGeneration
    ttsActive = true
    lastSpoken = text.trim()
    lastSpokenAt = Date.now()
    armUserListenClosed()
    syncMic()
    setDisplayPhase("speaking")
    voiceLogStage("TTS", `fetch ${text.length} chars raw=${raw} sidecar=${sidecar()}`)
    try {
      const bytes =
        audioBytes ??
        base64ToBytes((await fetchVoiceSpeak({ sidecarUrl: sidecar(), text, raw })).data)
      if (generation !== playGeneration || !running) {
        voiceLogStage("TTS", "abort stale generation after fetch")
        return
      }
      voiceLogStage("TTS", `play ${bytes.length} bytes format=mp3`)
      await playMp3(bytes)
      voiceLogStage("TTS", "play done")
    } catch (error) {
      if (generation !== playGeneration) return
      const message = error instanceof Error ? error.message : "voice speak failed"
      voiceLogStage("TTS", `error ${message}`)
      options.onError(message)
    }
    if (generation !== playGeneration) return
    finishSpeaking()
  }

  const speakPlanParts = async (texts: string[], raw = false, offerAtEnd = false) => {
    const generation = playGeneration
    if (offerAtEnd && texts.length > 1) {
      pendingOffer = true
      conversationPhase = "awaiting_reply"
      const offer = texts[texts.length - 1]
      if (offer?.trim()) prefetchOfferBytes(offer)
      prefetchNextContinuation()
    }
    for (let index = 0; index < texts.length; index++) {
      if (!running || generation !== playGeneration) return false
      const text = texts[index]
      if (!text.trim()) continue
      if (offerAtEnd && index === texts.length - 1) setDisplayPhase("awaiting_reply")
      const audioBytes =
        offerAtEnd && index === texts.length - 1
          ? consumePrefetchedOfferBytes(text)
          : consumePrefetchedSpeakBytes(text)
      await speakText(text, raw, audioBytes)
      if (generation !== playGeneration) return false
    }
    return true
  }

  const tryHandleOfferReply = (text: string) => {
    if (!pendingOffer || offerHandling) return false
    if (!userListenWindowOpen()) return false
    const reply = parseOfferReply(text)
    if (!reply) return false
    voiceLogStage("STATE", `offer-reply ${reply} "${text.slice(0, 40)}"`)
    void handleOfferReply(reply).catch((error) => {
      options.onError(error instanceof Error ? error.message : "voice offer reply failed")
    })
    return true
  }

  const loadContinuationChunkWithRetry = async () => {
    const chunk = await loadContinuationChunk()
    if (chunk.chunk?.trim() || chunk.done) return chunk
    voiceLogStage("STATE", "continuation-retry")
    clearContinuationPrefetch()
    return fetchVoiceContinuationChunk({
      sidecarUrl: sidecar(),
      fullText: fullReplyText,
      spokenSoFar,
    })
  }

  const handleOfferReply = async (reply: "yes" | "no") => {
    if (offerHandling) {
      voiceLogStage("STATE", "offer-reply-busy")
      return
    }
    offerHandling = true
    pendingOffer = false
    stopSpeaking()
    try {
      if (reply === "no") {
        clearContinuationPrefetch()
        offerDeclinedAt = Date.now()
        conversationPhase = "listening"
        setDisplayPhase("listening")
        return
      }
      if (actionOffer && closingQuestion.trim()) {
        clearContinuationPrefetch()
        conversationPhase = "listening"
        setDisplayPhase("listening")
        submitVoiceTurn(affirmativeActionPrompt(closingQuestion), true)
        return
      }
      if (!fullReplyText) {
        conversationPhase = "listening"
        setDisplayPhase("listening")
        return
      }
      conversationPhase = "continuing"
      setDisplayPhase("continuing")
      const chunk = await loadContinuationChunkWithRetry()
      if (!chunk.chunk?.trim()) {
        conversationPhase = "listening"
        setDisplayPhase("listening")
        return
      }
      await speakText(CONTINUATION_ACK, true)
      if (!running) return
      setDisplayPhase("continuing")
      spokenSoFar = `${spokenSoFar} ${chunk.chunk}`.trim()
      lastSpoken = chunk.chunk
      const parts = [chunk.chunk]
      const offerAtEnd = !!chunk.offer
      if (chunk.offer) parts.push(chunk.offer)
      conversationPhase = "continuing"
      await speakPlanParts(parts, true, offerAtEnd)
      if (!pendingOffer) {
        conversationPhase = "listening"
        setDisplayPhase("listening")
      }
    } finally {
      offerHandling = false
    }
  }

  const speakParts = async (texts: string[], raw = false) => {
    await speakPlanParts(texts, raw, false)
  }

  const canAcceptSpeech = () => userListenWindowOpen() && conversationPhase === "listening"

  const awaitingOfferReply = () => conversationPhase === "awaiting_reply" && pendingOffer

  const canContinueSpokenReply = () =>
    !!fullReplyText.trim() &&
    !!spokenSoFar.trim() &&
    spokenSoFar.length < fullReplyText.length - 20

  const handleOfferWaitSpeech = (text: string) => {
    if (!awaitingOfferReply()) return false
    if (tryStopSpeech(text, false)) return true
    if (tryInterruptAgent(text, false)) return true
    if (tryHandleOfferReply(text)) return true
    if (looksLikeAssistantEcho(text)) {
      voiceLogStage("STATE", `offer-echo-drop "${text.slice(0, 40)}"`)
      return true
    }
    voiceLogStage("STATE", `offer-wait-ignore "${text.slice(0, 40)}"`)
    return true
  }

  const tryContinueSpokenReply = (text: string) => {
    if (parseOfferReply(text) !== "yes") return false
    if (!canContinueSpokenReply()) return false
    voiceLogStage("STATE", `continuation-reply "${text.slice(0, 40)}"`)
    void handleOfferReply("yes").catch((error) => {
      options.onError(error instanceof Error ? error.message : "voice continuation failed")
    })
    return true
  }

  const awaitingPanelReply = () =>
    conversationPhase === "awaiting_question" || conversationPhase === "awaiting_permission"

  const schedulePartialFinal = (text: string) => {
    if (
      conversationPhase !== "listening" &&
      !awaitingOfferReply() &&
      conversationPhase !== "awaiting_agent" &&
      !awaitingPanelReply()
    ) {
      return
    }
    if (ttsActive || speakInFlight) {
      if (!awaitingOfferReply()) return
    }
    if (looksLikeAssistantEcho(text) && !awaitingOfferReply()) return
    partialText = text
    clearPartialTimer()
    const delay = awaitingOfferReply() || awaitingPanelReply() ? 700 : 1200
    partialTimer = setTimeout(() => {
      if (!partialText.trim() || partialText !== text) return
      if (ttsActive || speakInFlight) {
        if (!awaitingOfferReply()) return
      }
      if (
        conversationPhase !== "listening" &&
        !awaitingOfferReply() &&
        conversationPhase !== "awaiting_agent" &&
        !awaitingPanelReply()
      ) {
        return
      }
      clearPartialTimer()
      setHearing("")
      if (tryHandleOfferReply(text)) {
        partialText = ""
        return
      }
      handleSpeechFinal(partialText)
      partialText = ""
    }, delay)
  }

  const deciderPhase = () => {
    if (conversationPhase === "awaiting_question" || conversationPhase === "awaiting_permission") {
      return "awaiting_reply"
    }
    if (conversationPhase === "awaiting_reply" || conversationPhase === "continuing") return "awaiting_reply"
    if (ttsActive || speakInFlight) return "speaking"
    if (conversationPhase === "awaiting_agent" || options.working()) return "working"
    return "listening"
  }

  const isSpeaking = () => ttsActive || speakInFlight

  const submitVoiceTurn = (text: string, force = false) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (looksLikeAssistantEcho(trimmed)) {
      voiceLogStage("STATE", `submit-echo-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (!force && !bypassUserAdmission(trimmed) && !userListenWindowOpen()) {
      voiceLogStage("STATE", `submit-admission-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (!force && Date.now() - lastTtsEndedAt < ECHO_GUARD_MS && echoesRecentAssistantSpeech(trimmed)) {
      voiceLogStage("STATE", `submit-echo-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (!force && (speakInFlight || isSpeaking())) {
      voiceLogStage("STATE", `submit-speaking-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (!force && panelPending()) {
      voiceLogStage("STATE", `submit-panel-block "${trimmed.slice(0, 40)}"`)
      return
    }
    if (!force && conversationPhase === "awaiting_agent" && options.working()) {
      voiceLogStage("STATE", `submit-busy-block "${trimmed.slice(0, 40)}"`)
      return
    }
    voiceLogResetOnce()
    lastSubmitted = trimmed
    voiceLogStage("STATE", `submit ${trimmed.length} chars preview="${trimmed.slice(0, 40)}"`)
    options.submitTranscript(trimmed)
    setAwaitingSpeak(true)
    conversationPhase = "awaiting_agent"
    startAckTimer()
  }

  const handleMidTurnSpeech = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (tryStopSpeech(trimmed, false)) return
    if (tryInterruptAgent(trimmed, false)) return
    if (handleOfferWaitSpeech(trimmed)) return
    if (tryContinueSpokenReply(trimmed)) return

    try {
      const result = await fetchVoiceDecide({
        sidecarUrl: sidecar(),
        text: trimmed,
        phase: deciderPhase(),
        pendingOffer: pendingOffer,
        lastSpoken,
        progress: options.progressSnapshot?.(),
      })

      if (result.intent === "stop") {
        if (conversationPhase === "awaiting_agent" || options.working()) {
          interruptAgentTurn()
          return
        }
        stopSpeaking()
        return
      }

      if (result.intent === "status" && result.speak) {
        await speakText(result.speak, true)
        lastSpoken = result.speak
        return
      }

      if (result.intent === "reply") {
        if (result.reply === "no" || result.reply === "yes") {
          void handleOfferReply(result.reply)
          return
        }
      }

      if (result.intent === "redirect" || (result.intent === "command" && deciderPhase() !== "listening")) {
        if (looksLikeAssistantEcho(trimmed)) return
        if (!looksLikeNewCommand(trimmed)) {
          voiceLogStage("STATE", `redirect-skip-short "${trimmed.slice(0, 40)}"`)
          return
        }
        stopSpeaking()
        resetConversation()
        submitVoiceTurn(trimmed, true)
      }
    } catch (error) {
      options.onError(error instanceof Error ? error.message : "voice decide failed")
    }
  }

  const handleSpeechFinal = (text: string) => {
    if (!text.trim()) return
    if (offerDeclinedAt && Date.now() - offerDeclinedAt < OFFER_DECLINE_IGNORE_MS) {
      const normalized = normalizeVoiceText(text)
      if (parseOfferReply(text) === "no" || normalized === "okay" || normalized === "no") return
      if (isSpeaking()) return
    }
    if (tryStopSpeech(text, false)) return
    if (tryInterruptAgent(text, false)) return
    if (handleOfferWaitSpeech(text)) return
    if (tryHandleOfferReply(text)) return
    if (tryHandlePanelSpeech(text)) return
    if (offerHandling) {
      voiceLogStage("STATE", `continuing-ignore "${text.slice(0, 40)}"`)
      return
    }
    if (looksLikeAssistantEcho(text)) {
      voiceLogStage("STATE", `echo-drop "${text.slice(0, 40)}"`)
      return
    }
    if (conversationPhase === "listening" && echoesPriorSubmission(text, lastSubmitted)) {
      voiceLogStage("STATE", `submit-prior-drop "${text.slice(0, 40)}"`)
      return
    }
    if (conversationPhase === "listening" && echoesSpokenText(text, lastSpoken)) {
      voiceLogStage("STATE", `submit-spoken-drop "${text.slice(0, 40)}"`)
      return
    }

    if (isSpeaking()) {
      if (looksLikeAssistantEcho(text)) {
        voiceLogStage("STATE", `echo-drop-speaking "${text.slice(0, 40)}"`)
        return
      }
      if (tryStopSpeech(text, false)) return
      if (tryInterruptAgent(text, false)) return
      voiceLogStage("STATE", `barge-in "${text.slice(0, 40)}"`)
      void handleMidTurnSpeech(text)
      return
    }

    if (conversationPhase === "awaiting_agent") {
      if (textEchoesSpoken(text, lastSubmitted)) return
      if (textEchoesSpoken(text, lastSpoken)) return
      if (looksLikeAssistantEcho(text)) {
        voiceLogStage("STATE", `echo-drop-busy "${text.slice(0, 40)}"`)
        return
      }
      if (tryContinueSpokenReply(text)) return
      if (options.working() && looksLikeNewCommand(text) && !looksLikeAssistantEcho(text)) {
        voiceLogStage("STATE", `redirect-local "${text.slice(0, 40)}"`)
        options.interruptAgent?.()
        stopSpeaking()
        clearAckTimer()
        ackPlayedCount = 0
        setAwaitingSpeak(false)
        submitVoiceTurn(text, true)
        return
      }
      void handleMidTurnSpeech(text)
      return
    }

    if (conversationPhase === "listening") {
      if (tryContinueSpokenReply(text)) return
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
      if (event.text.trim() && !event.speechFinal) {
        if (tryStopSpeech(event.text, true)) return
        if (tryInterruptAgent(event.text, true)) return
        if (!admitUserTranscript(event.text)) {
          if (isAssistantSpeaking()) {
            voiceLogStage("STATE", `transcript-admission-drop "${event.text.slice(0, 40)}"`)
          }
          return
        }
        if (tryHandleOfferReply(event.text)) return
        if (handleOfferWaitSpeech(event.text)) return
        if (tryHandlePanelSpeech(event.text)) return
        if (looksLikeAssistantEcho(event.text)) {
          voiceLogStage("STATE", `echo-ignore-partial "${event.text.slice(0, 40)}"`)
          return
        }
        voiceLogStage("STATE", `transcript-partial "${event.text.slice(0, 40)}"`)
        showUserHearing(event.text)
        if (canFillPrompt()) {
          options.onTranscript?.(event.text)
          schedulePartialFinal(event.text)
          return
        }
        if (awaitingOfferReply() || awaitingPanelReply() || conversationPhase === "listening") {
          schedulePartialFinal(event.text)
        }
      }
      if (event.speechFinal) {
        voiceLogStage("STATE", `transcript-final "${event.text.slice(0, 60)}"`)
        clearPartialTimer()
        partialText = ""
        setHearing("")
        if (tryStopSpeech(event.text, false)) return
        if (tryInterruptAgent(event.text, false)) return
        if (!admitUserTranscript(event.text)) {
          voiceLogStage("STATE", `transcript-admission-drop "${event.text.slice(0, 40)}"`)
          return
        }
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
      if (options.working() && phase() !== "hearing" && !hearing().trim()) setDisplayPhase("working")
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
    syncMic()
    voiceLogStage("TTS", `reply-start ${reply.length} chars preview="${reply.slice(0, 60)}"`)
    try {
      const plan = await fetchVoiceFinalSpeak({ sidecarUrl: sidecar(), text: reply })
      voiceLogStage("TTS", `plan parts=${plan.parts.length} offer=${plan.hasOffer}`)
      fullReplyText = plan.fullText || reply
      spokenSoFar =
        plan.hasOffer && plan.parts.length > 1 ? plan.parts.slice(0, -1).join(" ").trim() : plan.parts.join(" ").trim()
      lastSpoken = spokenSoFar
      lastSpokenAt = Date.now()
      closingQuestion = plan.closingQuestion?.trim() ?? ""
      actionOffer = !!plan.actionOffer && !!closingQuestion
      pendingOffer = false
      const generation = playGeneration
      await speakPlanParts(plan.parts, true, plan.hasOffer)
      if (generation !== playGeneration) return
      if (!pendingOffer) {
        conversationPhase = "listening"
        setDisplayPhase("listening")
      }
      voiceLogStage("TTS", "reply-done")
    } catch (error) {
      const message = error instanceof Error ? error.message : "voice speak failed"
      voiceLogStage("TTS", `plan-error ${message} — fallback direct speak`)
      options.onError(message)
      lastSpoken = reply
      await speakText(reply, true)
      conversationPhase = "listening"
      setDisplayPhase("listening")
    } finally {
      speakInFlight = false
      syncMic()
    }
  }

  let lastSpeakWaitKey = ""

  createEffect(() => {
    if (!active()) return
    options.pendingQuestion?.()
    options.pendingPermission?.()
    syncPanelState()
  })

  createEffect(() => {
    if (!active() || !awaitingSpeak()) return
    if (options.working() && !hearing().trim()) {
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
    clearMicTailTimer()
    armUserListenClosed()
    resetConversation()
    setHearing("")
    clearPartialTimer()
    if (ws && ws.readyState === WebSocket.OPEN) {
      setMicEnabled(false)
      ws.close()
    }
    ws = undefined
    setActive(false)
    setPhase("off")
  }

  const start = async () => {
    if (running) return
    const sessionID = options.sessionID()
    if (!sessionID) throw new Error("no active session")

    speakInFlight = false
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
        openUserListen()
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
