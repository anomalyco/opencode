/**
 * Plugin sandbox for error isolation and resource limiting.
 * Wraps plugin hooks to prevent a misbehaving plugin from crashing the host.
 */
import { Log } from "../util/log"

const log = Log.create({ service: "plugin:sandbox" })

export namespace PluginSandbox {
  /** Maximum time a plugin hook can run (ms) */
  const HOOK_TIMEOUT = 10_000

  /** Maximum number of errors before disabling a plugin */
  const MAX_ERRORS = 5

  /** Track error counts per plugin */
  const errorCounts = new Map<string, number>()

  /** Disabled plugins */
  const disabledPlugins = new Set<string>()

  /** Check if a plugin is disabled */
  export function isDisabled(pluginId: string): boolean {
    return disabledPlugins.has(pluginId)
  }

  /** Record an error for a plugin */
  function recordError(pluginId: string, error: unknown) {
    const count = (errorCounts.get(pluginId) ?? 0) + 1
    errorCounts.set(pluginId, count)

    log.warn("Plugin error", { pluginId, error: error instanceof Error ? error : undefined, errorCount: count })

    if (count >= MAX_ERRORS) {
      disabledPlugins.add(pluginId)
      log.error("Plugin disabled due to excessive errors", { pluginId, errorCount: count })
    }
  }

  /** Reset error count for a plugin */
  export function resetErrors(pluginId: string) {
    errorCounts.delete(pluginId)
    disabledPlugins.delete(pluginId)
  }

  /** Wrap a plugin hook function with timeout and error isolation */
  export function wrapHook<T extends (...args: any[]) => any>(pluginId: string, hookName: string, fn: T): T {
    return (async (...args: Parameters<T>) => {
      if (isDisabled(pluginId)) {
        log.debug("Skipping disabled plugin hook", { pluginId, hookName })
        return undefined
      }

      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`Plugin hook timed out after ${HOOK_TIMEOUT}ms`)), HOOK_TIMEOUT)
        })
        const result = await Promise.race([fn(...args), timeoutPromise])
        return result
      } catch (error) {
        recordError(pluginId, error)
        return undefined
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    }) as T
  }

  /** Get plugin health status */
  export function getStatus(): Array<{
    pluginId: string
    errors: number
    disabled: boolean
  }> {
    const result: Array<{ pluginId: string; errors: number; disabled: boolean }> = []
    for (const [pluginId, errors] of errorCounts) {
      result.push({
        pluginId,
        errors,
        disabled: disabledPlugins.has(pluginId),
      })
    }
    return result
  }
}
