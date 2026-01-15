/**
 * SolidJS context provider for execution mode state.
 * Wraps ModeController in reactive signals for TUI integration.
 */

import { createContext, useContext, createSignal, type ParentProps } from "solid-js"
import { getModeController, ExecutionMode, type ModeDisplay } from "@shell-mode"

type ExecutionModeContextValue = {
  mode: () => ExecutionMode
  setMode: (mode: ExecutionMode) => void
  toggleMode: () => ExecutionMode
  getModeDisplay: () => ModeDisplay
}

const ExecutionModeContext = createContext<ExecutionModeContextValue>()

export function ExecutionModeProvider(props: ParentProps) {
  const controller = getModeController()
  const [mode, setModeSignal] = createSignal(controller.getMode())

  const setMode = (m: ExecutionMode) => {
    controller.setMode(m)
    setModeSignal(m)
  }

  const toggleMode = () => {
    const newMode = controller.toggleMode()
    setModeSignal(newMode)
    return newMode
  }

  const getModeDisplay = () => {
    // Access mode() to create reactive dependency
    mode()
    return controller.getModeDisplay()
  }

  return (
    <ExecutionModeContext.Provider value={{ mode, setMode, toggleMode, getModeDisplay }}>
      {props.children}
    </ExecutionModeContext.Provider>
  )
}

export function useExecutionMode() {
  const ctx = useContext(ExecutionModeContext)
  if (!ctx) {
    throw new Error("useExecutionMode must be used within ExecutionModeProvider")
  }
  return ctx
}
