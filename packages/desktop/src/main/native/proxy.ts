import type { ProxySettings } from "@opencode/app/desktop"
import { session } from "electron"
import { Effect } from "effect"
import { PROXY_SETTINGS_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { scoped } from "./logging"
import { proxyBypass, proxyEnvironment, proxyRules, readProxySettings } from "./proxy-config"

let applied: string[] = []

export function getProxySettings(): ProxySettings {
  return readProxySettings(getStore().get(PROXY_SETTINGS_KEY))
}

export function setProxySettings(value: ProxySettings) {
  getStore().set(PROXY_SETTINGS_KEY, value)
  applyProxySettings(value)
}

// Runs before the sidecar is spawned so it inherits the proxy through process.env.
export function applyProxySettings(value = getProxySettings()) {
  const environment = proxyEnvironment(value)

  for (const key of applied) {
    if (!(key in environment)) delete process.env[key]
  }

  Object.assign(process.env, environment)
  applied = Object.keys(environment)

  const rules = proxyRules(value)

  const config: Parameters<typeof session.defaultSession.setProxy>[0] = rules
    ? { proxyRules: rules, proxyBypassRules: proxyBypass(value) }
    : {}

  void session.defaultSession.setProxy(config).catch(() =>
    Effect.runFork(scoped("proxy", Effect.logWarning("failed to apply proxy"))),
  )
}
