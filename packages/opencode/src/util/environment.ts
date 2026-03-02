import { Log } from "./log"
import { execSync } from "child_process"

const log = Log.create({ service: "environment" })

/**
 * Cache for the detected user environment to avoid repeated shell executions
 */
let cachedUserEnv: NodeJS.ProcessEnv | undefined

/**
 * Check if env -0 is supported (GNU env feature, not available on BSD/macOS by default)
 */
function supportsEnvNullTerminator(): boolean {
  try {
    // Try to run env -0 and check if it works
    execSync("env -0", { encoding: "utf8", timeout: 1000 })
    return true
  } catch {
    return false
  }
}

/**
 * Detects the user's shell environment by running a login shell and capturing its environment variables.
 * This is necessary because spawned processes (like MCP servers) may not inherit the user's full
 * shell environment, especially tools installed in user directories (e.g., ~/.bun/bin).
 *
 * Works with any POSIX-compliant shell including bash, zsh, sh, and fish.
 * Fish is explicitly supported even though it's not POSIX-compliant.
 *
 * @returns The detected environment variables from the user's login shell
 */
export function detectUserEnvironment(): NodeJS.ProcessEnv {
  // Return cached environment if already detected
  if (cachedUserEnv) {
    return cachedUserEnv
  }

  // Default to current process environment
  const detectedEnv: NodeJS.ProcessEnv = { ...process.env }

  // Skip detection on Windows for now (can be enhanced later)
  if (process.platform === "win32") {
    cachedUserEnv = detectedEnv
    return detectedEnv
  }

  try {
    // Get the user's shell
    const shell = process.env.SHELL || "/bin/sh"
    const shellName = shell.split("/").pop() || "sh"
    
    // Determine the best command to get environment variables
    // Fish shell needs special handling since it's not POSIX-compliant
    let envCommand: string
    if (shellName === "fish") {
      // Fish: use 'set -x' to get exported variables, format as KEY=VALUE
      // Then convert to same format as env output
      envCommand = `${shell} -l -c 'for var in (set -x); echo $var; end'`
    } else {
      // Bash/Zsh/Sh: use env command
      // Try env -0 first (GNU extension for null-terminated output)
      // Fall back to regular env if not available (BSD/macOS)
      if (supportsEnvNullTerminator()) {
        envCommand = `${shell} -l -c 'env -0'`
      } else {
        envCommand = `${shell} -l -c 'env'`
      }
    }

    const envOutput = execSync(envCommand, {
      encoding: "utf8",
      timeout: 5000, // 5 second timeout
      windowsHide: true,
    })

    // Parse environment variables
    // If using env -0, split by null character
    // Otherwise split by newline (less robust for multiline values, but rare)
    const useNullTerminator = envCommand.includes("env -0")
    const separator = useNullTerminator ? "\0" : "\n"
    const envVars = envOutput.split(separator).filter((line) => line.includes("="))

    for (const line of envVars) {
      // Skip empty lines
      if (!line.trim()) continue
      
      const equalIndex = line.indexOf("=")
      if (equalIndex > 0) {
        const key = line.slice(0, equalIndex)
        const value = line.slice(equalIndex + 1)

        // Only update if we have a valid key
        if (key) {
          detectedEnv[key] = value
        }
      }
    }

    log.info("Detected user environment from login shell", {
      shell,
      path: detectedEnv.PATH?.slice(0, 100) + "...", // Log first 100 chars of PATH for debugging
    })
  } catch (error) {
    log.warn("Failed to detect user environment from login shell", {
      error: error instanceof Error ? error.message : String(error),
      shell: process.env.SHELL,
    })
    // Fall back to current process environment (already in detectedEnv)
  }

  cachedUserEnv = detectedEnv
  return detectedEnv
}

/**
 * Gets the effective environment for spawning child processes.
 * This merges the detected user shell environment with any additional overrides.
 *
 * @param overrides - Additional environment variables to merge
 * @returns The merged environment
 */
export function getEffectiveEnvironment(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const userEnv = detectUserEnvironment()

  if (!overrides) {
    return userEnv
  }

  return {
    ...userEnv,
    ...overrides,
  }
}

/**
 * Clears the cached user environment. Useful for testing or when the environment
 * needs to be re-detected.
 */
export function clearCachedEnvironment(): void {
  cachedUserEnv = undefined
}

/**
 * Inherits the user's shell environment into the current process.
 * This modifies process.env globally so that all child processes
 * inherit the correct environment variables (especially PATH).
 * 
 * This is critical for `opencode serve` to work correctly when
 * started from contexts that don't have the full user environment
 * (e.g., Desktop apps, launchd, systemd, etc.).
 */
export async function inheritUserEnvironment(): Promise<void> {
  const userEnv = detectUserEnvironment()
  
  // Track what we're modifying for logging
  const modifications: Record<string, { from: string; to: string }> = {}
  
  for (const [key, value] of Object.entries(userEnv)) {
    if (value === undefined) continue
    
    const currentValue = process.env[key]
    if (currentValue !== value) {
      if (currentValue) {
        modifications[key] = { from: currentValue.slice(0, 50), to: value.slice(0, 50) }
      }
      process.env[key] = value
    }
  }
  
  const modifiedKeys = Object.keys(modifications)
  if (modifiedKeys.length > 0) {
    log.info("Inherited user environment variables from login shell", {
      modified: modifiedKeys,
      pathChanged: modifications.PATH ? true : false,
    })
  } else {
    log.debug("No environment variable changes needed - already inherited")
  }
}
