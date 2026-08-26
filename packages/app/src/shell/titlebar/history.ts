export const MAX_TITLEBAR_HISTORY = 100

export type TitlebarAction = number | { replace?: boolean }

export type TitlebarHistory = {
  stack: string[]
  index: number
}

export function applyPath(
  state: TitlebarHistory,
  current: string,
  action?: TitlebarAction,
  max = MAX_TITLEBAR_HISTORY,
): TitlebarHistory {
  if (!state.stack.length) return { stack: [current], index: 0 }

  if (typeof action === "number") {
    const index = state.index + action
    if (state.stack[index] === current) return { ...state, index }
    return { stack: [current], index: 0 }
  }

  if (action?.replace) {
    return { ...state, stack: state.stack.map((path, index) => (index === state.index ? current : path)) }
  }

  if (current === state.stack[state.index]) return state

  // MemoryRouter history traversal does not notify useBeforeLeave.
  if (!action) {
    const before = state.stack.findLastIndex((path, index) => index < state.index && path === current)
    const after = state.stack.findIndex((path, index) => index > state.index && path === current)
    const index = before < 0 ? after : after < 0 || state.index - before <= after - state.index ? before : after
    if (index >= 0) return { ...state, index }
  }

  return pushPath(state, current, max)
}

export function pushPath(state: TitlebarHistory, path: string, max = MAX_TITLEBAR_HISTORY): TitlebarHistory {
  const stack = state.stack.slice(0, state.index + 1).concat(path)
  const next = trimHistory(stack, stack.length - 1, max)
  return { ...state, ...next }
}

export function trimHistory(stack: string[], index: number, max = MAX_TITLEBAR_HISTORY) {
  if (stack.length <= max) return { stack, index }
  const cut = stack.length - max
  return {
    stack: stack.slice(cut),
    index: Math.max(0, index - cut),
  }
}
