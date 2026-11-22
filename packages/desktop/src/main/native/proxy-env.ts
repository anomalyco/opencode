import type { ProxySettings } from "@opencode/app/desktop"
import { proxyEnvironment, proxyKeys } from "./proxy-config"

export function createProxyEnvironment() {
  let original: Record<string, string | undefined> | undefined

  return function applyProxyEnvironment(
    value: ProxySettings,
    env: Record<string, string | undefined> = process.env,
  ) {
    if (!value.enabled) {
      if (!original) return

      for (const [key, saved] of Object.entries(original)) {
        if (saved === undefined) delete env[key]
        else env[key] = saved
      }

      original = undefined

      return
    }

    original ??= Object.fromEntries(proxyKeys.map((key) => [key, env[key]]))
    Object.assign(env, proxyEnvironment(value, env))
  }
}

export const applyProxyEnvironment = createProxyEnvironment()
