export { TERMINAL_OPTIONS, RESIZE_DEBOUNCE_MS, FIRST_RENDER_RESTORE_FALLBACK_MS } from "./config"
export {
  createTerminalInstance,
  setupKeyboardHandler,
  setupPasteHandler,
  setupCopyHandler,
  setupResizeHandlers,
  scrollToBottom,
  type TerminalRendererRef,
  type CreateTerminalResult,
} from "./helpers"
export type { TerminalBackend, TerminalBackendOptions, TerminalColors } from "./backend/types"
