/**
 * TUI hooks for shell mode integration.
 * Provides keyboard handling and routing logic.
 */

import {
  getModeController,
  ExecutionMode,
  shouldRouteToShell,
  getCompletions,
  applyCompletion,
  findCommonPrefix,
  type CompletionResult,
} from "@shell-mode"
import type { KeyEvent } from "@opentui/core"

export type ModeToggleContext = {
  setMode: (mode: ExecutionMode) => void
}

export type TabCompletionContext = {
  input: string
  cursorPosition: number
  cwd?: string
}

export type TabCompletionResult = {
  /** New input string after applying completion */
  newInput: string
  /** New cursor position */
  newCursorPosition: number
  /** List of completions if multiple matches */
  completions: string[]
  /** Whether completion was applied (single match or common prefix) */
  applied: boolean
  /** Start position for replacement (for cycling) */
  replaceFrom: number
  /** End position for replacement (for cycling) */
  replaceTo: number
}

export type CompletionCycleState = {
  /** Original input before cycling started */
  originalInput: string
  /** Original cursor position */
  originalCursor: number
  /** List of completions to cycle through */
  completions: string[]
  /** Current index in the completion list */
  currentIndex: number
  /** Start position for replacement */
  replaceFrom: number
  /** End position for replacement */
  replaceTo: number
}

/**
 * Apply a specific completion from the cycle state.
 */
export function applyCompletionAtIndex(
  state: CompletionCycleState,
  index: number
): { newInput: string; newCursorPosition: number } {
  const completion = state.completions[index] ?? ""
  const newInput = applyCompletion(
    state.originalInput,
    completion,
    state.replaceFrom,
    state.replaceTo
  )
  const newCursorPosition = state.replaceFrom + completion.length

  return { newInput, newCursorPosition }
}

/**
 * Handle Ctrl+Space to toggle execution mode.
 * Returns true if the event was handled, false otherwise.
 */
export type KeybindMatcher = {
  match(key: string, evt: KeyEvent): boolean | undefined
}

export function handleModeToggleKey(e: KeyEvent, ctx: ModeToggleContext, keybind?: KeybindMatcher): boolean {
  if (keybind?.match("mode_toggle", e)) {
    const newMode = getModeController().toggleMode()
    ctx.setMode(newMode)
    return true
  }

  // Ctrl+Space to toggle mode
  // Note: Ctrl+Space can appear as sequence "\x00" (null) in some terminals
  if (
    !keybind &&
    e.ctrl &&
    !e.meta &&
    !e.shift &&
    (e.name === " " || e.name === "space" || e.sequence === "\x00")
  ) {
    const newMode = getModeController().toggleMode()
    ctx.setMode(newMode)
    return true
  }
  return false
}

/**
 * Determine routing for input based on current execution mode.
 * Returns "shell" or "agent".
 */
export async function determineRouting(input: string): Promise<"shell" | "agent"> {
  const mode = getModeController().getMode()

  if (mode === ExecutionMode.Shell) {
    return "shell"
  }

  if (mode === ExecutionMode.Agent) {
    return "agent"
  }

  // Auto mode: use command -v check
  const isCommand = await shouldRouteToShell(input)
  return isCommand ? "shell" : "agent"
}

/**
 * Check if shell tab completion should be used.
 * Returns true if in shell mode (! prefix) or execution mode is Shell/Auto.
 */
export function shouldUseShellCompletion(
  promptMode: "normal" | "shell",
  executionMode: ExecutionMode
): boolean {
  // Always use shell completion if in ! prefix shell mode
  if (promptMode === "shell") {
    return true
  }

  // Use shell completion in Shell or Auto execution modes
  return executionMode === ExecutionMode.Shell || executionMode === ExecutionMode.Auto
}

/**
 * Handle tab key press for shell completion.
 * Returns completion result with new input and available completions.
 */
export async function handleShellTabCompletion(
  ctx: TabCompletionContext
): Promise<TabCompletionResult> {
  const { input, cursorPosition, cwd } = ctx

  // Get completions for current input
  const result = await getCompletions(input, cursorPosition, cwd)

  if (result.completions.length === 0) {
    // No completions available
    return {
      newInput: input,
      newCursorPosition: cursorPosition,
      completions: [],
      applied: false,
      replaceFrom: result.replaceFrom,
      replaceTo: result.replaceTo,
    }
  }

  if (result.completions.length === 1) {
    // Single match - apply it directly
    const completion = result.completions[0]
    const newInput = applyCompletion(input, completion, result.replaceFrom, result.replaceTo)
    const newCursorPosition = result.replaceFrom + completion.length

    return {
      newInput,
      newCursorPosition,
      completions: result.completions,
      applied: true,
      replaceFrom: result.replaceFrom,
      replaceTo: result.replaceTo,
    }
  }

  // Multiple matches - find common prefix and apply if longer than current
  const commonPrefix = findCommonPrefix(result.completions)

  if (commonPrefix.length > result.prefix.length) {
    // Apply the common prefix
    const newInput = applyCompletion(input, commonPrefix, result.replaceFrom, result.replaceTo)
    const newCursorPosition = result.replaceFrom + commonPrefix.length

    return {
      newInput,
      newCursorPosition,
      completions: result.completions,
      applied: true,
      replaceFrom: result.replaceFrom,
      replaceTo: result.replaceTo,
    }
  }

  // Common prefix is same as current - return all completions for display
  return {
    newInput: input,
    newCursorPosition: cursorPosition,
    completions: result.completions,
    applied: false,
    replaceFrom: result.replaceFrom,
    replaceTo: result.replaceTo,
  }
}
