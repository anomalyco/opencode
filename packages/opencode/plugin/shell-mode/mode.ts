/**
 * Execution mode for input routing between shell and AI agent.
 */
export enum ExecutionMode {
  Shell = "Shell",
  Agent = "Agent",
  Auto = "Auto",
}

export type ModeDisplay = {
  name: string
  icon: string
  color: string
}

/**
 * Controller for managing execution mode state.
 * Singleton pattern - use getModeController() to access.
 */
export class ModeController {
  private currentMode: ExecutionMode = ExecutionMode.Auto

  getMode(): ExecutionMode {
    return this.currentMode
  }

  setMode(mode: ExecutionMode): void {
    this.currentMode = mode
  }

  /**
   * Cycle through modes: Auto -> Shell -> Agent -> Auto
   */
  toggleMode(): ExecutionMode {
    const modes = [ExecutionMode.Auto, ExecutionMode.Shell, ExecutionMode.Agent]
    const currentIndex = modes.indexOf(this.currentMode)
    this.currentMode = modes[(currentIndex + 1) % modes.length]
    return this.currentMode
  }

  getModeDisplay(): ModeDisplay {
    return getModeDisplay(this.currentMode)
  }
}

export function getModeDisplay(mode: ExecutionMode): ModeDisplay {
  switch (mode) {
    case ExecutionMode.Shell:
      return { name: "Shell", icon: ">", color: "success" }
    case ExecutionMode.Agent:
      return { name: "Agent", icon: "◆", color: "secondary" }
    case ExecutionMode.Auto:
      return { name: "Auto ", icon: "∞", color: "diffAdded" }
  }
}

let instance: ModeController | null = null

export function getModeController(): ModeController {
  if (!instance) {
    instance = new ModeController()
  }
  return instance
}
