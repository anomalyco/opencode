export const MAX_TITLEBAR_HISTORY = 100

export type TitlebarAction = "back" | "forward" | undefined

export type HistoryLocation = { url: string; state?: unknown }

export type TitlebarHistory = {
  stack: HistoryLocation[]
  index: number
  action: TitlebarAction
}

export function applyPath(
  state: TitlebarHistory,
  current: HistoryLocation,
  max = MAX_TITLEBAR_HISTORY,
): TitlebarHistory {
  if (!state.stack.length) {
    const stack = current.url === "/" ? [current] : [{ url: "/" }, current]
    return { stack, index: stack.length - 1, action: undefined }
  }

  const active = state.stack[state.index]
  if (current.url === active.url) {
    if (!state.action && current.state === active.state) return state
    return {
      ...state,
      stack: state.stack.map((entry, index) => (index === state.index ? current : entry)),
      action: undefined,
    }
  }

  if (state.action) return { ...state, action: undefined }

  return pushPath(state, current, max)
}

export function pushPath(state: TitlebarHistory, path: HistoryLocation, max = MAX_TITLEBAR_HISTORY): TitlebarHistory {
  const stack = state.stack.slice(0, state.index + 1).concat(path)
  const next = trimHistory(stack, stack.length - 1, max)
  return { ...state, ...next, action: undefined }
}

export function trimHistory(stack: HistoryLocation[], index: number, max = MAX_TITLEBAR_HISTORY) {
  if (stack.length <= max) return { stack, index }
  const cut = stack.length - max
  return {
    stack: stack.slice(cut),
    index: Math.max(0, index - cut),
  }
}

export function backPath(state: TitlebarHistory) {
  if (state.index <= 0) return
  const index = state.index - 1
  const to = state.stack[index]
  if (!to) return
  return { state: { ...state, index, action: "back" as const }, to }
}

export function forwardPath(state: TitlebarHistory) {
  if (state.index >= state.stack.length - 1) return
  const index = state.index + 1
  const to = state.stack[index]
  if (!to) return
  return { state: { ...state, index, action: "forward" as const }, to }
}
