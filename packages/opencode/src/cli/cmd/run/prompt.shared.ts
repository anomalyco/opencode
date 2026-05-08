// Pure state machine for the prompt input.
//
// Handles keybind parsing, history ring navigation, and the leader-key
// sequence for variant cycling. All functions are pure -- they take state
// in and return new state out, with no side effects.
//
// The history ring (PromptHistoryState) stores past prompts and tracks
// the current browse position. When the user arrows up at cursor offset 0,
// the current draft is saved and history begins. Arrowing past the end
// restores the draft.
//
// The leader-key cycle (promptCycle) uses a two-step pattern: first press
// arms the leader, second press within the timeout fires the action.
import type { KeyBinding } from "@opentui/core"
import { formatBinding, parseBindings } from "./keymap.shared"
import type { FooterKeybinds, RunPrompt } from "./types"

const HISTORY_LIMIT = 200

export type PromptHistoryState = {
  items: RunPrompt[]
  index: number | null
  draft: string
}

export function promptInfo(event: { name: string; ctrl?: boolean; meta?: boolean; shift?: boolean; super?: boolean }) {
  return {
    name: event.name === " " ? "space" : event.name,
    ctrl: !!event.ctrl,
    meta: !!event.meta,
    shift: !!event.shift,
    super: !!event.super,
    leader: false,
  }
}

type PromptInfo = ReturnType<typeof promptInfo>

export type PromptKeys = {
  leaders: PromptInfo[]
  cycles: PromptInfo[]
  interrupts: PromptInfo[]
  previous: PromptInfo[]
  next: PromptInfo[]
  clear: PromptInfo[]
  bindings: KeyBinding[]
}

export type PromptCycle = {
  arm: boolean
  clear: boolean
  cycle: boolean
  consume: boolean
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
  }
}

export function promptSame(a: RunPrompt, b: RunPrompt): boolean {
  return a.text === b.text && JSON.stringify(a.parts) === JSON.stringify(b.parts)
}

function promptKey(binding: ReturnType<typeof parseBindings>[number]): PromptInfo | undefined {
  if (binding.event !== "press") {
    return undefined
  }

  const first = binding.sequence[0]
  const second = binding.sequence[1]

  if (!first) {
    return undefined
  }

  if (!second) {
    return first.patternName || first.tokenName
      ? undefined
      : {
          name: first.stroke.name,
          ctrl: first.stroke.ctrl,
          meta: first.stroke.meta,
          shift: first.stroke.shift,
          super: first.stroke.super,
          leader: false,
        }
  }

  if (binding.sequence.length !== 2 || first.tokenName !== "leader" || second.patternName || second.tokenName) {
    return undefined
  }

  return {
    name: second.stroke.name,
    ctrl: second.stroke.ctrl,
    meta: second.stroke.meta,
    shift: second.stroke.shift,
    super: second.stroke.super,
    leader: true,
  }
}

export function promptBindings(bindings: FooterKeybinds["commandList"], leader: string): PromptInfo[] {
  return parseBindings(bindings, leader).flatMap((binding) => {
    const key = promptKey(binding)
    return key ? [key] : []
  })
}

function mapInputBindings(
  bindings: FooterKeybinds["inputSubmit"],
  leader: string,
  action: "submit" | "newline",
): KeyBinding[] {
  return promptBindings(bindings, leader).flatMap((key) => {
    if (key.leader) {
      return []
    }

    return [
      {
        name: key.name,
        ctrl: key.ctrl || undefined,
        meta: key.meta || undefined,
        shift: key.shift || undefined,
        super: key.super || undefined,
        action,
      },
    ]
  })
}

function textareaBindings(keybinds: FooterKeybinds): KeyBinding[] {
  return [
    ...mapInputBindings(keybinds.inputSubmit, keybinds.leader, "submit"),
    ...mapInputBindings(keybinds.inputNewline, keybinds.leader, "newline"),
  ]
}

export function promptKeys(keybinds: FooterKeybinds): PromptKeys {
  return {
    leaders: promptBindings([{ key: keybinds.leader }], keybinds.leader),
    cycles: promptBindings(keybinds.variantCycle, keybinds.leader),
    interrupts: promptBindings(keybinds.interrupt, keybinds.leader),
    previous: promptBindings(keybinds.historyPrevious, keybinds.leader),
    next: promptBindings(keybinds.historyNext, keybinds.leader),
    clear: promptBindings(keybinds.inputClear, keybinds.leader),
    bindings: textareaBindings(keybinds),
  }
}

export function printableBinding(bindings: FooterKeybinds["commandList"], leader: string): string {
  return formatBinding(bindings, leader)
}

export function isExitCommand(input: string): boolean {
  const text = input.trim().toLowerCase()
  return text === "/exit" || text === "/quit" || text === ":q"
}

export function isNewCommand(input: string): boolean {
  return input.trim().toLowerCase() === "/new"
}

export function promptHit(bindings: PromptInfo[], event: PromptInfo): boolean {
  return bindings.some(
    (item) =>
      item.name === event.name &&
      item.ctrl === event.ctrl &&
      item.meta === event.meta &&
      item.shift === event.shift &&
      item.super === event.super &&
      item.leader === event.leader,
  )
}

export function promptCycle(
  armed: boolean,
  event: PromptInfo,
  leaders: PromptInfo[],
  cycles: PromptInfo[],
): PromptCycle {
  if (!armed && promptHit(leaders, event)) {
    return {
      arm: true,
      clear: false,
      cycle: false,
      consume: true,
    }
  }

  if (armed) {
    return {
      arm: false,
      clear: true,
      cycle: promptHit(cycles, { ...event, leader: true }),
      consume: true,
    }
  }

  if (!promptHit(cycles, event)) {
    return {
      arm: false,
      clear: false,
      cycle: false,
      consume: false,
    }
  }

  return {
    arm: false,
    clear: false,
    cycle: true,
    consume: true,
  }
}

export function createPromptHistory(items?: RunPrompt[]): PromptHistoryState {
  const list = (items ?? []).filter((item) => item.text.trim().length > 0).map(promptCopy)
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
  if (!prompt.text.trim()) {
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

export function movePromptHistory(state: PromptHistoryState, dir: -1 | 1, text: string, cursor: number): PromptMove {
  if (state.items.length === 0) {
    return { state, apply: false }
  }

  if (dir === -1 && cursor !== 0) {
    return { state, apply: false }
  }

  if (dir === 1 && cursor !== text.length) {
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
      cursor: state.draft.length,
      apply: true,
    }
  }

  return {
    state: {
      ...state,
      index: idx,
    },
    text: state.items[idx].text,
    cursor: dir === -1 ? 0 : state.items[idx].text.length,
    apply: true,
  }
}
