import { Instance } from "../project/instance"

/**
 * Environment variable management namespace.
 *
 * Provides isolated per-instance environment variable access and modification.
 * Uses instance state to prevent parallel tests from interfering with each other's
 * environment variables.
 *
 * @example
 * ```typescript
 * Env.set("MY_VAR", "value")
 * const value = Env.get("MY_VAR")
 * Env.remove("MY_VAR")
 * ```
 */
export namespace Env {
  const state = Instance.state(() => {
    // Create a shallow copy to isolate environment per instance
    // Prevents parallel tests from interfering with each other's env vars
    return { ...process.env } as Record<string, string | undefined>
  })

  /**
   * Retrieves the value of an environment variable.
   *
   * @param key - The name of the environment variable
   * @returns The value of the environment variable, or undefined if not set
   */
  export function get(key: string) {
    const env = state()
    return env[key]
  }

  /**
   * Retrieves all environment variables as a record.
   *
   * @returns A record containing all environment variables
   */
  export function all() {
    return state()
  }

  /**
   * Sets the value of an environment variable.
   *
   * @param key - The name of the environment variable
   * @param value - The value to set
   */
  export function set(key: string, value: string) {
    const env = state()
    env[key] = value
  }

  /**
   * Removes an environment variable.
   *
   * @param key - The name of the environment variable to remove
   */
  export function remove(key: string) {
    const env = state()
    delete env[key]
  }
}
