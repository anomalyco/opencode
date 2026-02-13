export type WaitState = {
  waiting: boolean
  waited: boolean
  readyBytes: number
}

export type WaitProfile = {
  minMs: number
  maxMs: number
  minReadyBytes: number
}

export const MIN_WAITING_MS = 450
export const MAX_WAITING_MS = 5000
export const MIN_READY_BYTES = 1
export const COMMAND_MIN_WAITING_MS = 900
export const COMMAND_MAX_WAITING_MS = 7000
export const COMMAND_MIN_READY_BYTES = 2048

export function waitProfile(commandStart: boolean): WaitProfile {
  if (!commandStart)
    return {
      minMs: MIN_WAITING_MS,
      maxMs: MAX_WAITING_MS,
      minReadyBytes: MIN_READY_BYTES,
    }
  return {
    minMs: COMMAND_MIN_WAITING_MS,
    maxMs: COMMAND_MAX_WAITING_MS,
    minReadyBytes: COMMAND_MIN_READY_BYTES,
  }
}

export function initWait(hasBuffer: boolean): WaitState {
  return {
    waiting: !hasBuffer,
    waited: hasBuffer,
    readyBytes: 0,
  }
}

export function markInput(state: WaitState) {
  return { ...state, waiting: false, waited: true }
}

export function markBytes(state: WaitState, bytes: number, minReadyBytes = MIN_READY_BYTES) {
  const next = Math.max(0, bytes)
  const readyBytes = state.readyBytes + next
  if (readyBytes < minReadyBytes) return { ...state, readyBytes }
  return { ...state, readyBytes, waiting: false, waited: true }
}

export function markElapsed(state: WaitState, elapsedMs: number, minMs = MIN_WAITING_MS, maxMs = MAX_WAITING_MS) {
  const waited = state.waited || elapsedMs >= minMs
  const waiting = elapsedMs >= maxMs ? false : state.waiting
  return { ...state, waited, waiting }
}

export function showWaiting(state: WaitState) {
  return state.waiting || !state.waited
}
