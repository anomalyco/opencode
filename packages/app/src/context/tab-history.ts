const MAX_TAB_HISTORY = 100

export type TabHistory = {
  stack: string[]
  index: number
}

export function rememberTab(state: TabHistory, key: string): TabHistory {
  if (state.stack[state.index] === key) return state
  const stack = state.stack.slice(0, state.index + 1).concat(key).slice(-MAX_TAB_HISTORY)
  return { stack, index: stack.length - 1 }
}

export function previousTab(state: TabHistory, available: Set<string>) {
  return move(state, -1, available)
}

export function nextTab(state: TabHistory, available: Set<string>) {
  return move(state, 1, available)
}

function move(state: TabHistory, offset: -1 | 1, available: Set<string>) {
  const current = state.stack[state.index]
  for (let index = state.index + offset; index >= 0 && index < state.stack.length; index += offset) {
    const key = state.stack[index]
    if (key && key !== current && available.has(key)) return { state: { ...state, index }, key }
  }
}
