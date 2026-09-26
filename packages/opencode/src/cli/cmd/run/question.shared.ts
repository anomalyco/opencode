// Pure state machine for the question UI.
//
// Supports both single-question and multi-question flows. Single questions
// submit immediately on selection. Multi-question flows use tabs and a
// final confirmation step.
//
// State transitions:
//   questionSelect  → picks an option (single: submits, multi: toggles/advances)
//   questionSave    → saves custom text input
//   questionMove    → arrow key navigation through options
//   questionSetTab  → tab navigation between questions
//   questionSubmit  → builds the final QuestionReply with all answers
//
// Custom answers: if a question has custom=true, an extra "Type your own
// answer" option appears. Selecting it enters editing mode with a text field.
import type { QuestionInfo, QuestionRequest } from "@opencode-ai/sdk/v2"
import type { QuestionReject, QuestionReply } from "./types"

export type QuestionBodyState = {
  requestID: string
  tab: number
  answers: string[][]
  custom: string[]
  selected: number
  editing: boolean
  submitting: boolean
}

export type QuestionStep = {
  state: QuestionBodyState
  reply?: QuestionReply
}

export function createQuestionBodyState(requestID: string): QuestionBodyState {
  return {
    requestID,
    tab: 0,
    answers: [],
    custom: [],
    selected: 0,
    editing: false,
    submitting: false,
  }
}

export function questionSync(state: QuestionBodyState, requestID: string): QuestionBodyState {
  if (state.requestID === requestID) {
    return state
  }

  return createQuestionBodyState(requestID)
}

export function questionSingle(request: QuestionRequest): boolean {
  return request.questions.length === 1 && request.questions[0]?.multiple !== true
}

export function questionTabs(request: QuestionRequest): number {
  return questionSingle(request) ? 1 : request.questions.length + 1
}

export function questionConfirm(request: QuestionRequest, state: QuestionBodyState): boolean {
  return !questionSingle(request) && state.tab === request.questions.length
}

export function questionInfo(request: QuestionRequest, state: QuestionBodyState): QuestionInfo | undefined {
  return request.questions[state.tab]
}

export function questionCustom(request: QuestionRequest, state: QuestionBodyState): boolean {
  return questionInfo(request, state)?.custom !== false
}

export function questionInput(state: QuestionBodyState): string {
  return state.custom[state.tab] ?? ""
}

export function questionPicked(state: QuestionBodyState): boolean {
  const value = questionInput(state)
  if (!value) {
    return false
  }

  return state.answers[state.tab]?.includes(value) ?? false
}

export function questionOther(request: QuestionRequest, state: QuestionBodyState): boolean {
  const info = questionInfo(request, state)
  if (!info || info.custom === false) {
    return false
  }

  return state.selected === info.options.length
}

export function questionTotal(request: QuestionRequest, state: QuestionBodyState): number {
  const info = questionInfo(request, state)
  if (!info) {
    return 0
  }

  return info.options.length + (questionCustom(request, state) ? 1 : 0)
}

export function questionAnswers(state: QuestionBodyState, count: number): string[][] {
  return Array.from({ length: count }, (_, idx) => state.answers[idx] ?? [])
}

export function questionSetTab(state: QuestionBodyState, tab: number): QuestionBodyState {
  return {
    ...state,
    tab,
    selected: 0,
    editing: false,
  }
}

export function questionSetSelected(state: QuestionBodyState, selected: number): QuestionBodyState {
  return {
    ...state,
    selected,
  }
}

export function questionSetEditing(state: QuestionBodyState, editing: boolean): QuestionBodyState {
  return {
    ...state,
    editing,
  }
}

export function questionSetSubmitting(state: QuestionBodyState, submitting: boolean): QuestionBodyState {
  return {
    ...state,
    submitting,
  }
}

function storeAnswers(state: QuestionBodyState, tab: number, list: string[]): QuestionBodyState {
  const answers = [...state.answers]
  answers[tab] = list
  return {
    ...state,
    answers,
  }
}

export function questionStoreCustom(state: QuestionBodyState, tab: number, text: string): QuestionBodyState {
  const custom = [...state.custom]
  custom[tab] = text
  return {
    ...state,
    custom,
  }
}

function questionPick(
  state: QuestionBodyState,
  request: QuestionRequest,
  answer: string,
  custom = false,
): QuestionStep {
  const answers = [...state.answers]
  answers[state.tab] = [answer]
  let next: QuestionBodyState = {
    ...state,
    answers,
    editing: false,
  }

  if (custom) {
    const list = [...state.custom]
    list[state.tab] = answer
    next = {
      ...next,
      custom: list,
    }
  }

  if (questionSingle(request)) {
    return {
      state: next,
      reply: {
        requestID: request.id,
        answers: [[answer]],
      },
    }
  }

  return {
    state: questionSetTab(next, state.tab + 1),
  }
}

function questionToggle(state: QuestionBodyState, answer: string): QuestionBodyState {
  const list = [...(state.answers[state.tab] ?? [])]
  const idx = list.indexOf(answer)
  if (idx === -1) {
    list.push(answer)
  } else {
    list.splice(idx, 1)
  }

  return storeAnswers(state, state.tab, list)
}

export function questionMove(state: QuestionBodyState, request: QuestionRequest, dir: -1 | 1): QuestionBodyState {
  const total = questionTotal(request, state)
  if (total === 0) {
    return state
  }

  return {
    ...state,
    selected: (state.selected + dir + total) % total,
  }
}

export function questionSelect(state: QuestionBodyState, request: QuestionRequest): QuestionStep {
  const info = questionInfo(request, state)
  if (!info) {
    return { state }
  }

  if (questionOther(request, state)) {
    if (!info.multiple) {
      return {
        state: questionSetEditing(state, true),
      }
    }

    const value = questionInput(state)
    if (value && questionPicked(state)) {
      return {
        state: questionToggle(state, value),
      }
    }

    return {
      state: questionSetEditing(state, true),
    }
  }

  const option = info.options[state.selected]
  if (!option) {
    return { state }
  }

  if (info.multiple) {
    return {
      state: questionToggle(state, option.label),
    }
  }

  return questionPick(state, request, option.label)
}

export function questionSave(state: QuestionBodyState, request: QuestionRequest): QuestionStep {
  const info = questionInfo(request, state)
  if (!info) {
    return { state }
  }

  const value = questionInput(state).trim()
  const prev = state.custom[state.tab]
  if (!value) {
    if (!prev) {
      return {
        state: questionSetEditing(state, false),
      }
    }

    const next = questionStoreCustom(state, state.tab, "")
    return {
      state: questionSetEditing(
        storeAnswers(
          next,
          state.tab,
          (state.answers[state.tab] ?? []).filter((item) => item !== prev),
        ),
        false,
      ),
    }
  }

  if (info.multiple) {
    const answers = [...(state.answers[state.tab] ?? [])]
    if (prev) {
      const idx = answers.indexOf(prev)
      if (idx !== -1) {
        answers.splice(idx, 1)
      }
    }

    if (!answers.includes(value)) {
      answers.push(value)
    }

    const next = questionStoreCustom(state, state.tab, value)
    return {
      state: questionSetEditing(storeAnswers(next, state.tab, answers), false),
    }
  }

  return questionPick(state, request, value, true)
}

export function questionSubmit(request: QuestionRequest, state: QuestionBodyState): QuestionReply {
  return {
    requestID: request.id,
    answers: questionAnswers(state, request.questions.length),
  }
}

export function questionReject(request: QuestionRequest): QuestionReject {
  return {
    requestID: request.id,
  }
}

export function questionHint(request: QuestionRequest, state: QuestionBodyState): string {
  if (state.submitting) {
    return "Waiting for question event..."
  }

  if (questionConfirm(request, state)) {
    return "enter submit   esc dismiss"
  }

  if (state.editing) {
    return "enter save   esc cancel"
  }

  const info = questionInfo(request, state)
  if (questionSingle(request)) {
    return `↑↓ select   enter ${info?.multiple ? "toggle" : "submit"}   esc dismiss`
  }

  return `⇆ tab   ↑↓ select   enter ${info?.multiple ? "toggle" : "confirm"}   esc dismiss`
}
