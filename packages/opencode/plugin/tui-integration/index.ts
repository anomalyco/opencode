/**
 * TUI Integration Plugin
 *
 * Provides SolidJS integration for shell mode in the TUI.
 */

export { ExecutionModeProvider, useExecutionMode } from "./execution-mode-provider"
export { WorkingDirProvider, useWorkingDir } from "./working-dir-provider"
export { handleModeToggleKey, determineRouting, type ModeToggleContext } from "./hooks"
