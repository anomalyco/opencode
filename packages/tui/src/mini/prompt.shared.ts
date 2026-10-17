// Pure state machine for the prompt input.
//
// Handles history ring navigation and prompt text helpers. All functions are
// pure -- they take state in and return new state out, with no side effects.
//
// The history ring (PromptHistoryState) stores past prompts and tracks
// the current browse position. When the user arrows up at cursor offset 0,
// the current draft is saved and history begins. Arrowing past the end
// restores the draft.
export { mentionTriggerIndex, slashTriggerIndex } from "../prompt/display"
import { measureEditText, type WidthMethod } from "@opentui/core"
import type { RunPrompt } from "./types"

const HISTORY_LIMIT = 200

export type PromptHistoryState = {
  items: RunPrompt[]
  index: number | null
  draft: string
}

export type PromptMove = {
  state: PromptHistoryState
  text?: string
  cursor?: number
  apply: boolean
}

export function promptCopy(prompt: RunPrompt): RunPrompt {
  return {
    text: prompt.text,
    parts: structuredClone(prompt.parts),
    ...(prompt.mode ? { mode: prompt.mode } : {}),
    ...(prompt.command ? { command: prompt.command } : {}),
  }
}

// Part ranges are textarea offsets, so shift by the measured offset rather than string length.
export function promptAppend(prompt: RunPrompt, following: RunPrompt, widthMethod: WidthMethod): RunPrompt {
  const text = prompt.text ? `${prompt.text}\n\n` : ""
  const offset = measureEditText(text, { widthMethod })
  const shift = <T extends { start: number; end: number }>(range: T) => ({
    ...range,
    start: range.start + offset,
    end: range.end + offset,
  })
  const command = prompt.text ? prompt.command : following.command
  return {
    text: text + following.text,
    parts: [
      ...structuredClone(prompt.parts),
      ...structuredClone(following.parts).map((part) => {
        if (!part.source) return part
        if (part.type === "file") return { ...part, source: { ...part.source, text: shift(part.source.text) } }
        return { ...part, source: shift(part.source) }
      }),
    ],
    ...(command ? { command } : {}),
  }
}

export function promptSame(a: RunPrompt, b: RunPrompt): boolean {
  return (
    a.mode === b.mode &&
    a.text === b.text &&
    JSON.stringify(a.parts) === JSON.stringify(b.parts) &&
    JSON.stringify(a.command) === JSON.stringify(b.command)
  )
}

export const EXIT_COMMANDS = ["exit", "quit", "q"]

export function isExitCommand(input: string): boolean {
  const text = input.trim().toLowerCase()
  return text === ":q" || EXIT_COMMANDS.some((name) => text === `/${name}`)
}

export function isNewCommand(input: string): boolean {
  return input.trim().toLowerCase() === "/new"
}

export function isCompactCommand(input: string): boolean {
  return input.trim().toLowerCase() === "/compact"
}

export function createPromptHistory(items?: RunPrompt[]): PromptHistoryState {
  const list = (items ?? [])
    .filter((item) => item.text.trim().length > 0 || item.parts.some((part) => part.type === "file"))
    .map(promptCopy)
  const next: RunPrompt[] = []
  for (const item of list) {
    if (next.length > 0 && promptSame(next[next.length - 1], item)) {
      continue
    }

    next.push(item)
  }

  return {
    items: next.slice(-HISTORY_LIMIT),
    index: null,
    draft: "",
  }
}

export function pushPromptHistory(state: PromptHistoryState, prompt: RunPrompt): PromptHistoryState {
  if (!prompt.text.trim() && !prompt.parts.some((part) => part.type === "file")) {
    return state
  }

  const next = promptCopy(prompt)
  if (state.items[state.items.length - 1] && promptSame(state.items[state.items.length - 1], next)) {
    return {
      ...state,
      index: null,
      draft: "",
    }
  }

  const items = [...state.items, next].slice(-HISTORY_LIMIT)
  return {
    ...state,
    items,
    index: null,
    draft: "",
  }
}

export function movePromptHistory(
  state: PromptHistoryState,
  dir: -1 | 1,
  text: string,
  cursor: number,
  widthMethod: WidthMethod,
): PromptMove {
  if (state.items.length === 0) {
    return { state, apply: false }
  }

  if (dir === -1 && cursor !== 0) {
    return { state, apply: false }
  }

  if (dir === 1 && cursor !== measureEditText(text, { widthMethod })) {
    return { state, apply: false }
  }

  if (state.index === null) {
    if (dir === 1) {
      return { state, apply: false }
    }

    const idx = state.items.length - 1
    return {
      state: {
        ...state,
        index: idx,
        draft: text,
      },
      text: state.items[idx].text,
      cursor: 0,
      apply: true,
    }
  }

  const idx = state.index + dir
  if (idx < 0) {
    return { state, apply: false }
  }

  if (idx >= state.items.length) {
    return {
      state: {
        ...state,
        index: null,
      },
      text: state.draft,
      cursor: measureEditText(state.draft, { widthMethod }),
      apply: true,
    }
  }

  return {
    state: {
      ...state,
      index: idx,
    },
    text: state.items[idx].text,
    cursor: dir === -1 ? 0 : measureEditText(state.items[idx].text, { widthMethod }),
    apply: true,
  }
}
