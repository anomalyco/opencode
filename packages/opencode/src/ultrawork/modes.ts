/**
 * ULTRAWORK Modes - Smart Mode Switching
 *
 * Implements Roo Code-style specialized modes that automatically
 * switch based on the current phase of work.
 *
 * Each mode restricts the AI to a specific role:
 * - Architect: Planning, design, no code editing
 * - Code: Implementation, full edit access
 * - Debug: Investigation, logging, breakpoints
 * - Test: Test writing and validation
 * - Review: Code review, security audit
 * - Orchestrator: Coordinates all other modes
 *
 * Mode switching happens automatically based on:
 * - Task phase (planning -> coding -> testing)
 * - Error detection (failures trigger debug mode)
 * - Completion signals (code done -> test mode)
 *
 * Inspired by:
 * - Roo Code's mode-based architecture
 * - Roo Code's self-initiated mode switching
 * - Roo Code's orchestrator mode for multi-step workflows
 */

import { Log } from "../util/log"

export type UltraworkMode =
  | "architect"
  | "code"
  | "debug"
  | "test"
  | "review"
  | "orchestrator"
  | "research"
  | "deploy"

export interface ModeConfig {
  name: UltraworkMode
  displayName: string
  description: string
  color: string
  allowedActions: string[]
  restrictedActions: string[]
  suggestsTransitionTo: UltraworkMode[]
  preferredModel: string
  temperature: number
}

export namespace UltraworkModes {
  const log = Log.create({ service: "ultrawork.modes" })

  /**
   * All available modes with their configurations
   */
  const MODES: Record<UltraworkMode, ModeConfig> = {
    architect: {
      name: "architect",
      displayName: "Architect",
      description: "Planning and design phase. Analyzes requirements, designs architecture, creates project structure. No direct code editing.",
      color: "#7B68EE",
      allowedActions: ["read", "glob", "grep", "websearch", "webfetch", "plan-enter", "plan-exit", "task"],
      restrictedActions: ["edit", "write", "bash"],
      suggestsTransitionTo: ["code", "research"],
      preferredModel: "claude-opus-4-5-20251101",
      temperature: 0.3,
    },
    code: {
      name: "code",
      displayName: "Code",
      description: "Implementation phase. Full access to code editing, file creation, and command execution.",
      color: "#00D4AA",
      allowedActions: ["read", "edit", "write", "glob", "grep", "bash", "task"],
      restrictedActions: [],
      suggestsTransitionTo: ["test", "debug", "review"],
      preferredModel: "claude-opus-4-5-20251101",
      temperature: 0.1,
    },
    debug: {
      name: "debug",
      displayName: "Debug",
      description: "Debugging phase. Systematic bug investigation with instrumentation logging and root cause analysis.",
      color: "#FF6B6B",
      allowedActions: ["read", "edit", "glob", "grep", "bash", "task"],
      restrictedActions: ["write"],
      suggestsTransitionTo: ["code", "test"],
      preferredModel: "claude-opus-4-5-20251101",
      temperature: 0.1,
    },
    test: {
      name: "test",
      displayName: "Test",
      description: "Testing phase. Write and run tests, validate functionality, check coverage.",
      color: "#FFD93D",
      allowedActions: ["read", "edit", "write", "glob", "grep", "bash", "task"],
      restrictedActions: [],
      suggestsTransitionTo: ["debug", "code", "review"],
      preferredModel: "claude-opus-4-5-20251101",
      temperature: 0.1,
    },
    review: {
      name: "review",
      displayName: "Review",
      description: "Code review phase. Security audit, quality check, best practices validation. Read-only.",
      color: "#4ECDC4",
      allowedActions: ["read", "glob", "grep", "websearch", "task"],
      restrictedActions: ["edit", "write", "bash"],
      suggestsTransitionTo: ["code", "debug"],
      preferredModel: "claude-opus-4-5-20251101",
      temperature: 0.2,
    },
    orchestrator: {
      name: "orchestrator",
      displayName: "Orchestrator",
      description: "Master coordination mode. Routes tasks between other modes, manages parallel execution, synthesizes results.",
      color: "#9B59B6",
      allowedActions: ["read", "glob", "grep", "task", "websearch", "webfetch", "bash"],
      restrictedActions: [],
      suggestsTransitionTo: ["architect", "code", "test", "deploy"],
      preferredModel: "claude-opus-4-5-20251101",
      temperature: 0.2,
    },
    research: {
      name: "research",
      displayName: "Research",
      description: "Research phase. Web searching, documentation reading, API exploration. No code changes.",
      color: "#3498DB",
      allowedActions: ["read", "glob", "grep", "websearch", "webfetch", "task"],
      restrictedActions: ["edit", "write", "bash"],
      suggestsTransitionTo: ["architect", "code"],
      preferredModel: "gemini-3-pro",
      temperature: 0.3,
    },
    deploy: {
      name: "deploy",
      displayName: "Deploy",
      description: "Deployment phase. Build, package, deploy, and verify. Full system access.",
      color: "#E67E22",
      allowedActions: ["read", "edit", "write", "glob", "grep", "bash", "task"],
      restrictedActions: [],
      suggestsTransitionTo: ["test", "review"],
      preferredModel: "claude-opus-4-5-20251101",
      temperature: 0.1,
    },
  }

  /**
   * Get mode configuration
   */
  export function getMode(mode: UltraworkMode): ModeConfig {
    return MODES[mode]
  }

  /**
   * Get all available modes
   */
  export function listModes(): ModeConfig[] {
    return Object.values(MODES)
  }

  /**
   * Check if an action is allowed in the current mode
   */
  export function isActionAllowed(mode: UltraworkMode, action: string): boolean {
    const config = MODES[mode]
    if (config.restrictedActions.includes(action)) return false
    if (config.allowedActions.length === 0) return true
    return config.allowedActions.includes(action)
  }

  /**
   * Suggest the next mode based on current context
   */
  export function suggestNextMode(
    currentMode: UltraworkMode,
    context: {
      hasErrors?: boolean
      hasNewCode?: boolean
      testsExist?: boolean
      testsPassing?: boolean
      phaseComplete?: boolean
    },
  ): UltraworkMode {
    // Error detection -> Debug mode
    if (context.hasErrors) {
      return "debug"
    }

    // Phase-specific transitions
    switch (currentMode) {
      case "architect":
        if (context.phaseComplete) return "code"
        break

      case "code":
        if (context.hasNewCode && context.testsExist === false) return "test"
        if (context.phaseComplete) return "test"
        break

      case "debug":
        if (!context.hasErrors) return "code"
        break

      case "test":
        if (context.testsPassing) return "review"
        if (context.hasErrors) return "debug"
        break

      case "review":
        if (context.phaseComplete) return "deploy"
        break

      case "research":
        if (context.phaseComplete) return "architect"
        break

      case "deploy":
        if (context.hasErrors) return "debug"
        break
    }

    return currentMode // Stay in current mode
  }

  /**
   * Get the full mode transition graph
   */
  export function getTransitionGraph(): Record<UltraworkMode, UltraworkMode[]> {
    const graph: Record<string, UltraworkMode[]> = {}
    for (const [mode, config] of Object.entries(MODES)) {
      graph[mode] = config.suggestsTransitionTo
    }
    return graph as Record<UltraworkMode, UltraworkMode[]>
  }

  /**
   * Build a system prompt addition for the current mode
   */
  export function getModePrompt(mode: UltraworkMode): string {
    const config = MODES[mode]
    const lines = [
      `You are currently in **${config.displayName}** mode.`,
      ``,
      `${config.description}`,
      ``,
    ]

    if (config.restrictedActions.length > 0) {
      lines.push(`**Restricted actions in this mode:** ${config.restrictedActions.join(", ")}`)
      lines.push(`Do NOT use these tools unless explicitly switching modes.`)
      lines.push(``)
    }

    lines.push(`**Suggested transitions:** When this phase is complete, consider switching to: ${config.suggestsTransitionTo.join(", ")}`)

    return lines.join("\n")
  }
}
