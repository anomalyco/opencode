import type { ParsedKey, TextareaRenderable } from "@opentui/core"
import type { JSX } from "solid-js"

/**
 * Safe context for prompt extensions to interact with the textarea
 * without directly accessing internal state management
 */
export interface PromptExtensionContext {
  /** Get current text content */
  getText: () => string
  /** Set text content and sync prompt state */
  setText: (text: string) => void
  /** Get cursor position */
  getCursor: () => { row: number; col: number; offset: number }
  /** Set cursor position */
  setCursor: (row: number, col: number) => void
  /** Insert text at cursor and sync state */
  insertText: (text: string) => void
  /** Delete character at cursor */
  deleteChar: () => void
  /** Delete character before cursor */
  deleteCharBackward: () => void
  /** Move cursor */
  moveCursor: (direction: "left" | "right" | "up" | "down") => void
  /** Move by word */
  moveWord: (direction: "forward" | "backward") => void
  /** Get line count */
  getLineCount: () => number
  /** Get visible height */
  getHeight: () => number
  /** Get visual cursor row (for wrapped lines) */
  getVisualRow: () => number
  /** Native undo */
  undo: () => void
  /** Native redo */
  redo: () => void
  /** Request render update */
  requestRender: () => void
  /** Access to raw textarea for advanced operations */
  readonly textarea: TextareaRenderable
}

/**
 * Key event with full context for extensions
 */
export interface PromptKeyEvent {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  sequence: string
  preventDefault: () => void
  defaultPrevented?: boolean
}

/**
 * Command item for extension commands
 */
export interface ExtensionCommand {
  title: string
  value: string
  category?: string
  keybind?: string
  onSelect: () => void
}

/**
 * Key handling phase - determines order of execution
 * - "pre": Before standard handling (history, autocomplete)
 * - "normal": Standard phase
 * - "post": After standard handling
 */
export type KeyHandlingPhase = "pre" | "normal" | "post"

/**
 * Prompt extension interface
 *
 * Extensions can hook into the prompt to provide custom editing modes,
 * key bindings, status indicators, and commands.
 */
export interface PromptExtension {
  /** Unique identifier for the extension */
  id: string

  /** Whether the extension is currently enabled */
  enabled: () => boolean

  /**
   * Handle key events
   * @param event - The key event
   * @param ctx - Safe context for interacting with the textarea
   * @returns true if the key was handled and should not propagate
   */
  handleKey?: (event: PromptKeyEvent, ctx: PromptExtensionContext) => boolean

  /** Key handling phase - defaults to "normal" */
  keyPhase?: KeyHandlingPhase

  /**
   * Handle escape key specifically
   * Called before standard escape handling (interrupt, etc.)
   * @returns true if escape was handled
   */
  handleEscape?: () => boolean

  /**
   * Check if session interrupt should be blocked
   * @returns true to block interrupt
   */
  blockInterrupt?: () => boolean

  /**
   * Status indicator component for the prompt footer
   */
  StatusIndicator?: () => JSX.Element

  /**
   * Additional commands to add to the command palette
   */
  commands?: () => ExtensionCommand[]

  /**
   * Overlay component (e.g., help dialog)
   */
  Overlay?: () => JSX.Element

  /**
   * Called when extension is enabled/disabled
   */
  onToggle?: (enabled: boolean) => void

  /**
   * Reset extension state
   */
  reset?: () => void

  /**
   * Get current mode state (for vi mode: "normal" | "insert")
   * Used by prompt for mode-aware handling
   */
  getState?: () => string
}

/**
 * Create a prompt extension context from a textarea
 */
export function createExtensionContext(
  textarea: TextareaRenderable,
  onContentChange: () => void,
): PromptExtensionContext {
  return {
    getText: () => textarea.plainText,
    setText: (text: string) => {
      textarea.setText(text)
      onContentChange()
    },
    getCursor: () => {
      const cursor = textarea.editorView.getCursor()
      return { row: cursor.row, col: cursor.col, offset: textarea.cursorOffset }
    },
    setCursor: (row: number, col: number) => {
      textarea.editBuffer.setCursor(row, col)
    },
    insertText: (text: string) => {
      textarea.insertText(text)
      onContentChange()
    },
    deleteChar: () => {
      textarea.deleteChar()
      onContentChange()
    },
    deleteCharBackward: () => {
      textarea.deleteCharBackward()
      onContentChange()
    },
    moveCursor: (direction) => {
      switch (direction) {
        case "left":
          textarea.moveCursorLeft()
          break
        case "right":
          textarea.moveCursorRight()
          break
        case "up":
          textarea.moveCursorUp()
          break
        case "down":
          textarea.moveCursorDown()
          break
      }
    },
    moveWord: (direction) => {
      if (direction === "forward") textarea.moveWordForward()
      else textarea.moveWordBackward()
    },
    getLineCount: () => textarea.lineCount,
    getHeight: () => textarea.height,
    getVisualRow: () => textarea.visualCursor.visualRow,
    undo: () => textarea.undo(),
    redo: () => textarea.redo(),
    requestRender: () => textarea.requestRender(),
    get textarea() {
      return textarea
    },
  }
}
