import { Log } from "../util/log"
import { Config } from "../config/config"

export namespace ToolGuardrails {
  const log = Log.create({ service: "tool-guardrails" })

  // Default settings
  export const DEFAULT_MAX_CONSECUTIVE_IDENTICAL = 3
  export const DEFAULT_SANDBOX_MODE = false
  export const DEFAULT_DANGEROUS_PATTERNS = [
    "rm -rf",
    "mkfs",
    "dd if=",
    "> /dev/",
    "chmod 777",
    "chown root",
    "sudo rm",
    ":(){ :|:& };:", // fork bomb
    "mv * /dev/null",
    "format c:",
    "del /f /s /q",
  ]

  // Runtime configuration
  let MAX_CONSECUTIVE_IDENTICAL = DEFAULT_MAX_CONSECUTIVE_IDENTICAL
  let SANDBOX_MODE = DEFAULT_SANDBOX_MODE
  let DANGEROUS_PATTERNS: string[] = DEFAULT_DANGEROUS_PATTERNS
  let ENABLED = true

  /**
   * Load configuration settings
   */
  async function loadConfig() {
    const config = await Config.get()
    const safety = config.safety?.tool_calling

    if (!safety) return

    ENABLED = safety.enabled ?? true
    MAX_CONSECUTIVE_IDENTICAL = safety.max_consecutive_identical ?? DEFAULT_MAX_CONSECUTIVE_IDENTICAL
    SANDBOX_MODE = safety.sandbox_mode ?? DEFAULT_SANDBOX_MODE
    DANGEROUS_PATTERNS = safety.dangerous_patterns ?? DEFAULT_DANGEROUS_PATTERNS

    log.info("config loaded", {
      enabled: ENABLED,
      maxConsecutiveIdentical: MAX_CONSECUTIVE_IDENTICAL,
      sandboxMode: SANDBOX_MODE,
      dangerousPatterns: DANGEROUS_PATTERNS.length,
    })
  }

  // Load config on module initialization
  loadConfig().catch((err) => {
    log.error("failed to load config, using defaults", { error: err })
  })

  export type LintResult = {
    safe: boolean
    warnings: string[]
    errors: string[]
    requiresConfirmation: boolean
    dangerousPatterns: string[]
    suggestion?: string
  }

  type ToolCallHistory = {
    toolName: string
    params: any
    timestamp: number
  }

  const sessionHistory = new Map<string, ToolCallHistory[]>()

  /**
   * Get or create session history
   */
  function getHistory(sessionID: string): ToolCallHistory[] {
    if (!sessionHistory.has(sessionID)) {
      sessionHistory.set(sessionID, [])
    }
    return sessionHistory.get(sessionID)!
  }

  /**
   * Cleanup session history
   */
  export function cleanup(sessionID: string) {
    sessionHistory.delete(sessionID)
  }

  /**
   * Detect dangerous patterns in bash commands
   */
  function detectDangerousPatterns(command: string): string[] {
    const detected: string[] = []

    for (const pattern of DANGEROUS_PATTERNS) {
      // Case-insensitive match
      if (command.toLowerCase().includes(pattern.toLowerCase())) {
        detected.push(pattern)
      }
    }

    return detected
  }

  /**
   * Detect recursive tool-calling patterns
   */
  function detectRecursivePattern(
    sessionID: string,
    toolName: string,
    params: any,
  ): {
    isRecursive: boolean
    consecutiveCount: number
  } {
    const history = getHistory(sessionID)

    // Check last N calls
    const recent = history.slice(-MAX_CONSECUTIVE_IDENTICAL)

    // Serialize params for comparison
    const paramsKey = JSON.stringify(params)
    let consecutiveCount = 0

    for (let i = recent.length - 1; i >= 0; i--) {
      const call = recent[i]
      if (call.toolName === toolName && JSON.stringify(call.params) === paramsKey) {
        consecutiveCount++
      } else {
        break
      }
    }

    return {
      isRecursive: consecutiveCount >= MAX_CONSECUTIVE_IDENTICAL,
      consecutiveCount,
    }
  }

  /**
   * Lint a bash command before execution
   */
  export function lintBashCommand(input: {
    sessionID: string
    command: string
    description?: string
  }): LintResult {
    if (!ENABLED) {
      return {
        safe: true,
        warnings: [],
        errors: [],
        requiresConfirmation: false,
        dangerousPatterns: [],
      }
    }

    const warnings: string[] = []
    const errors: string[] = []
    const dangerousPatterns = detectDangerousPatterns(input.command)

    // Check for dangerous patterns
    if (dangerousPatterns.length > 0) {
      if (SANDBOX_MODE) {
        errors.push(`Dangerous patterns detected: ${dangerousPatterns.join(", ")}`)
        errors.push("Sandbox mode is enabled - this command is blocked")
      } else {
        warnings.push(`⚠️ Dangerous patterns detected: ${dangerousPatterns.join(", ")}`)
      }
    }

    // Check for recursive patterns
    const recursiveCheck = detectRecursivePattern(input.sessionID, "bash", { command: input.command })
    if (recursiveCheck.isRecursive) {
      errors.push(
        `Recursive tool-calling detected: "${input.command}" called ${recursiveCheck.consecutiveCount} times consecutively`,
      )
    }

    // Additional safety checks
    const checks = [
      {
        test: () => input.command.includes("sudo") && input.command.includes("rm"),
        warning: "Command uses sudo with rm - this can be very destructive",
      },
      {
        test: () => input.command.match(/rm\s+(-rf|--recursive\s+--force)/),
        warning: "Recursive force deletion detected - ensure you're deleting the correct path",
      },
      {
        test: () => input.command.includes("chmod 777"),
        warning: "Setting 777 permissions is a security risk",
      },
      {
        test: () => input.command.match(/>\s*\/dev\/(sd[a-z]|nvme[0-9])/),
        warning: "Writing directly to disk devices can destroy data",
      },
    ]

    for (const check of checks) {
      if (check.test()) {
        warnings.push(check.warning)
      }
    }

    const result: LintResult = {
      safe: errors.length === 0 && (!SANDBOX_MODE || dangerousPatterns.length === 0),
      warnings,
      errors,
      requiresConfirmation: dangerousPatterns.length > 0 || warnings.length > 0,
      dangerousPatterns,
    }

    if (!result.safe && dangerousPatterns.length > 0) {
      result.suggestion = SANDBOX_MODE
        ? "Disable sandbox mode in config to allow this command, or modify the command to avoid dangerous patterns"
        : "Review the command carefully before proceeding, or enable sandbox mode to block such commands"
    }

    if (recursiveCheck.isRecursive) {
      result.suggestion =
        "This appears to be a recursive loop. Check your code logic or increase max_consecutive_identical in config if intentional"
    }

    log.info("bash command linted", {
      sessionID: input.sessionID,
      safe: result.safe,
      warnings: result.warnings.length,
      errors: result.errors.length,
      dangerousPatterns: result.dangerousPatterns.length,
    })

    return result
  }

  /**
   * Lint any tool call before execution
   */
  export function lintToolCall(input: {
    sessionID: string
    toolName: string
    params: any
  }): {
    safe: boolean
    warnings: string[]
    consecutiveCount: number
  } {
    if (!ENABLED) {
      return {
        safe: true,
        warnings: [],
        consecutiveCount: 0,
      }
    }

    const warnings: string[] = []

    // Check for recursive patterns
    const recursiveCheck = detectRecursivePattern(input.sessionID, input.toolName, input.params)

    if (recursiveCheck.isRecursive) {
      warnings.push(
        `⚠️ Tool "${input.toolName}" called ${recursiveCheck.consecutiveCount} times with identical parameters`,
      )
      warnings.push("This may indicate a recursive loop or infinite retry pattern")
    }

    log.info("tool call linted", {
      sessionID: input.sessionID,
      toolName: input.toolName,
      consecutiveCount: recursiveCheck.consecutiveCount,
      warnings: warnings.length,
    })

    return {
      safe: !recursiveCheck.isRecursive,
      warnings,
      consecutiveCount: recursiveCheck.consecutiveCount,
    }
  }

  /**
   * Record a tool call in history
   */
  export function recordToolCall(sessionID: string, toolName: string, params: any) {
    if (!ENABLED) return

    const history = getHistory(sessionID)
    history.push({
      toolName,
      params,
      timestamp: Date.now(),
    })

    // Keep only last 20 calls to prevent memory leak
    if (history.length > 20) {
      history.shift()
    }

    // Clean up old calls (older than 5 minutes)
    const cutoff = Date.now() - 5 * 60 * 1000
    const filtered = history.filter((call) => call.timestamp > cutoff)
    sessionHistory.set(sessionID, filtered)
  }

  /**
   * Get history for a session
   */
  export function getToolCallHistory(sessionID: string): ToolCallHistory[] {
    return getHistory(sessionID)
  }

  /**
   * Reload configuration
   */
  export async function reloadConfig() {
    await loadConfig()
  }

  /**
   * Check if sandbox mode is enabled
   */
  export function isSandboxMode(): boolean {
    return SANDBOX_MODE
  }
}
