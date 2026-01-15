/**
 * SolidJS context provider for working directory state.
 * Tracks the current working directory and provides reactive updates.
 */

import { createContext, useContext, createSignal, createEffect, onCleanup, onMount, type ParentProps } from "solid-js"
import { getCwd } from "@shell-mode"

type WorkingDirContextValue = {
  workingDir: () => string
  setWorkingDir: (dir: string) => void
}

const WorkingDirContext = createContext<WorkingDirContextValue>()

export function WorkingDirProvider(props: ParentProps) {
  // Use process.cwd() as initial value since Instance may not be ready yet
  const [workingDir, setWorkingDirSignal] = createSignal(process.cwd())

  // Update to actual cwd once mounted (Instance should be ready by then)
  onMount(() => {
    try {
      const currentDir = getCwd()
      if (workingDir() !== currentDir) {
        setWorkingDirSignal(currentDir)
      }
    } catch {
      // Instance not ready yet, will be updated by polling
    }
  })

  // Poll for changes when not in a session (fallback for direct shell commands)
  createEffect(() => {
    const interval = setInterval(() => {
      try {
        const currentDir = getCwd()
        if (workingDir() !== currentDir) {
          setWorkingDirSignal(currentDir)
        }
      } catch {
        // Instance not ready yet
      }
    }, 500)

    onCleanup(() => clearInterval(interval))
  })

  const setWorkingDir = (dir: string) => {
    setWorkingDirSignal(dir)
  }

  return (
    <WorkingDirContext.Provider value={{ workingDir, setWorkingDir }}>
      {props.children}
    </WorkingDirContext.Provider>
  )
}

export function useWorkingDir() {
  const ctx = useContext(WorkingDirContext)
  if (!ctx) {
    throw new Error("useWorkingDir must be used within WorkingDirProvider")
  }
  return ctx
}
