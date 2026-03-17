import { Instance } from "../project/instance"

/**
 * Environment variable management namespace.
 *
 * Provides isolated environment variable access per instance to prevent
 * parallel tests from interfering with each other's environment.
 *
 * @example
 * ```typescript
 * Env.set("MY_VAR", "value")
 * const value = Env.get("MY_VAR")
 * const all = Env.all()
 * ```
 */
export namespace Env {
  const state = Instance.state(() => {
    // Create a shallow copy to isolate environment per instance
    // Prevents parallel tests from interfering with each other's env vars
    return { ...process.env } as Record<string, string | undefined>
  })

  /**
   * Gets an environment variable value for the current instance.
   *
   * @param key - The environment variable name
   * @returns The value of the environment variable, or undefined if not set
   */
  export function get(key: string) {
    const env = state()
    return env[key]
  }

  /**
   * Returns all environment variables for the current instance.
   *
   * @returns Record of environment variables
   */
  export function all() {
    return state()
  }

  /**
   * Sets an environment variable for the current instance.
   *
   * @param key - The environment variable name
   * @param value - The value to set
   */
  export function set(key: string, value: string) {
    const env = state()
    env[key] = value
  }

  /**
   * Removes an environment variable for the current instance.
   *
   * @param key - The environment variable name to remove
   */
  export function remove(key: string) {
    const env = state()
    delete env[key]
  }
}
