import type { QuestionAnswer, QuestionInfo } from "@opencode-ai/sdk/v2"

export type VoiceQuestionPhase = "readiness" | "options_pref" | "asking" | "confirm"

export type VoiceQuestionState = {
  requestID: string
  questions: QuestionInfo[]
  tab: number
  answers: QuestionAnswer[]
  single: boolean
  phase: VoiceQuestionPhase
  readAllOptions: boolean
}

export type VoiceQuestionAction =
  | { type: "reply"; answers: QuestionAnswer[] }
  | { type: "advance"; state: VoiceQuestionState; speakAfter?: string }
  | { type: "summary"; state: VoiceQuestionState }
  | { type: "reject" }
  | { type: "none" }

export type VoicePermissionReply = "once" | "always" | "reject"

function normalize(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
}

function optionIndex(text: string, total: number) {
  const normalized = normalize(text)
  if (!normalized) return undefined
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1
    if (index >= 0 && index < total) return index
    return undefined
  }
  const word = NUMBER_WORDS[normalized]
  if (word && word - 1 < total) return word - 1
  const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"]
  const ordinal = ordinals.indexOf(normalized)
  if (ordinal >= 0 && ordinal < total) return ordinal
  return undefined
}

function matchOption(text: string, options: QuestionInfo["options"]) {
  const normalized = normalize(text)
  if (!normalized) return undefined
  const index = optionIndex(normalized, options.length)
  if (index !== undefined) return options[index]
  for (const option of options) {
    const label = normalize(option.label)
    const description = normalize(option.description)
    if (normalized === label || normalized.includes(label) || label.includes(normalized)) return option
    if (description && (normalized.includes(description) || description.includes(normalized))) return option
  }
  return undefined
}

export function createVoiceQuestionState(input: {
  requestID: string
  questions: QuestionInfo[]
}): VoiceQuestionState {
  return {
    requestID: input.requestID,
    questions: input.questions,
    tab: 0,
    answers: input.questions.map(() => []),
    single: input.questions.length === 1 && input.questions[0]?.multiple !== true,
    phase: "readiness",
    readAllOptions: false,
  }
}

function onConfirmTab(state: VoiceQuestionState) {
  return state.phase === "asking" && !state.single && state.tab >= state.questions.length
}

export function questionIntroSpeech(count: number) {
  const label = count === 1 ? "1 question" : `${count} questions`
  return `I have ${label} for you. Ready to answer?`
}

export function questionOptionsPrefSpeech() {
  return "Do you want me to read out all the options, or will you look at the screen?"
}

export function questionSummarySpeech(state: VoiceQuestionState) {
  const parts = state.questions.map((question, index) => {
    const answer = state.answers[index]?.join(", ") || "no answer"
    return `${question.question}: ${answer}`
  })
  return `Here is what I heard. ${parts.join(". ")}. Say confirm when you're ready to submit.`
}

export function parseReadinessReply(text: string): "yes" | "no" | undefined {
  const normalized = normalize(text)
  if (!normalized) return undefined
  if (/^(yes|yeah|yep|sure|ready|ok|okay|go ahead|let s go|i m ready|sounds good)\b/.test(normalized)) {
    return "yes"
  }
  if (/^(no|nope|not now|later|cancel|skip|not yet)\b/.test(normalized)) return "no"
  return undefined
}

export function parseOptionsPrefReply(text: string): "read" | "screen" | undefined {
  const normalized = normalize(text)
  if (!normalized) return undefined
  if (/\b(read|read them|read all|read it|all of them|out loud|yes|yeah|sure|please)\b/.test(normalized)) {
    return "read"
  }
  if (/\b(screen|look|see|myself|manual|type|keyboard|no|nope|on screen)\b/.test(normalized)) return "screen"
  return undefined
}

export function parseSummaryRequest(text: string) {
  return /\b(summary|recap|repeat|review|run through)\b/.test(normalize(text))
}

function confirmSpeech(text: string) {
  const normalized = normalize(text)
  return /^(yes|yeah|yep|confirm|submit|done|continue|proceed|ok|okay|go ahead)\b/.test(normalized)
}

export function rejectSpeech(text: string) {
  const normalized = normalize(text)
  return /^(no|nope|cancel|reject|stop|skip|never mind|nevermind)\b/.test(normalized)
}

function doneSpeech(text: string) {
  return /^(done|next|continue|that s all|finished|move on|no more)\b/.test(normalize(text))
}

function advanceQuestion(state: VoiceQuestionState, answers: QuestionAnswer[]) {
  const next = { ...state, answers }
  if (state.single) return { type: "reply" as const, answers }
  if (state.tab >= state.questions.length - 1) {
    next.tab = state.questions.length
    next.phase = "confirm"
    return { type: "advance" as const, state: next }
  }
  next.tab = state.tab + 1
  return { type: "advance" as const, state: next }
}

export function applyVoiceQuestionAnswer(state: VoiceQuestionState, text: string): VoiceQuestionAction {
  if (state.phase === "readiness") {
    if (rejectSpeech(text)) return { type: "reject" }
    const reply = parseReadinessReply(text)
    if (reply === "no") return { type: "reject" }
    if (reply === "yes") return { type: "advance", state: { ...state, phase: "options_pref" } }
    return { type: "none" }
  }

  if (state.phase === "options_pref") {
    if (rejectSpeech(text)) return { type: "reject" }
    const reply = parseOptionsPrefReply(text)
    if (reply === "read") {
      return { type: "advance", state: { ...state, phase: "asking", readAllOptions: true, tab: 0 } }
    }
    if (reply === "screen") {
      return { type: "advance", state: { ...state, phase: "asking", readAllOptions: false, tab: 0 } }
    }
    return { type: "none" }
  }

  if (onConfirmTab(state)) {
    if (parseSummaryRequest(text)) return { type: "summary", state }
    if (confirmSpeech(text)) return { type: "reply", answers: state.answers }
    return { type: "none" }
  }

  const question = state.questions[state.tab]
  if (!question) return { type: "none" }

  if (rejectSpeech(text)) return { type: "reject" }

  if (question.multiple) {
    if (doneSpeech(text) && state.answers[state.tab]?.length) return advanceQuestion(state, state.answers)
    const option = matchOption(text, question.options)
    if (option) {
      const current = state.answers[state.tab] ?? []
      if (current.includes(option.label)) {
        return { type: "advance", state, speakAfter: `${option.label} is already selected. Say another option or done.` }
      }
      const answers = [...state.answers]
      answers[state.tab] = [...current, option.label]
      return {
        type: "advance",
        state: { ...state, answers },
        speakAfter: `Got ${option.label}. Say another option or done.`,
      }
    }
  }

  const option = matchOption(text, question.options)
  if (option) {
    const answers = [...state.answers]
    answers[state.tab] = [option.label]
    return advanceQuestion({ ...state, answers }, answers)
  }

  if (question.custom !== false) {
    const trimmed = text.trim()
    if (trimmed.length >= 3 && !/^(type your own|custom answer)\b/i.test(trimmed)) {
      const answers = [...state.answers]
      answers[state.tab] = [trimmed]
      return advanceQuestion({ ...state, answers }, answers)
    }
  }

  return { type: "none" }
}

export function questionPromptSpeech(state: VoiceQuestionState) {
  if (state.phase === "readiness") return questionIntroSpeech(state.questions.length)
  if (state.phase === "options_pref") return questionOptionsPrefSpeech()
  if (onConfirmTab(state)) {
    return "Say confirm when you're ready to submit, or say summary for a recap."
  }
  const question = state.questions[state.tab]
  if (!question) return ""
  const prefix = state.questions.length > 1 ? `Question ${state.tab + 1}. ` : ""
  if (!state.readAllOptions) {
    return `${prefix}${question.question} Look at the screen for the options, then say your answer.`
  }
  const options = question.options.map((option, index) => `${index + 1}, ${option.label}`).join(". ")
  const multi = question.multiple ? " You can pick more than one. Say done when finished." : ""
  return `${prefix}${question.question} Options: ${options}. Say an option or a number.${multi}`
}

export function parsePermissionReply(text: string): VoicePermissionReply | undefined {
  const normalized = normalize(text)
  if (!normalized) return undefined
  if (/\b(reject|deny|no|nope|cancel|stop|block|decline)\b/.test(normalized)) return "reject"
  if (/\b(always|every time|allow always)\b/.test(normalized)) return "always"
  if (/\b(allow once|once|allow|approve|yes|yeah|ok|okay|sure|go ahead)\b/.test(normalized)) return "once"
  return undefined
}

export function permissionPromptSpeech() {
  return "Permission required. Say allow once, allow always, or reject."
}
