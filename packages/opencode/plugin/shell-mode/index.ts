/**
 * Shell Mode Plugin
 *
 * Provides execution mode switching between Shell, Agent, and Auto modes.
 * Auto mode uses `command -v` to intelligently route input.
 */

export { ExecutionMode, ModeController, getModeController, getModeDisplay, type ModeDisplay } from "./mode"
export { shouldRouteToShell } from "./command-check"
export { getCwd, setCwd, resetCwd, CwdEvent } from "./cwd"
export {
  execute as SessionShellExecute,
  dispose as SessionShellDispose,
  disposeAll as SessionShellDisposeAll,
  type ExecOptions,
  type ExecResult,
} from "./session-shell"
export { getCompletions, applyCompletion, findCommonPrefix, type CompletionResult } from "./completion"
