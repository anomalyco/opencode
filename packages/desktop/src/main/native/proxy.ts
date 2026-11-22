import http from "node:http"
import type { ProxySettings } from "@opencode/app/desktop"
import { session } from "electron"
import { Effect } from "effect"
import { PROXY_SETTINGS_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { scoped } from "./logging"
import { proxyBypass, proxyRules, readProxySettings } from "./proxy-config"
import { applyProxyEnvironment } from "./proxy-env"

export function getProxySettings(): ProxySettings {
  return readProxySettings(getStore().get(PROXY_SETTINGS_KEY))
}

// The Electron session exists only after app.whenReady(), so prepareDesktop calls this after that.
export function applyProxySession(value = getProxySettings()) {
  const rules = proxyRules(value)

  const config: Parameters<typeof session.defaultSession.setProxy>[0] = rules
    ? { proxyRules: rules, proxyBypassRules: proxyBypass(value) }
    : { mode: "system" }

  void session.defaultSession.setProxy(config).catch(() =>
    Effect.runFork(scoped("proxy", Effect.logWarning("failed to apply proxy"))),
  )
}

export function refreshNodeProxy() {
  const proxyAwareHttp = http as typeof http & { setGlobalProxyFromEnv?(): void }
  proxyAwareHttp.setGlobalProxyFromEnv?.()
}

export function setProxySettings(value: ProxySettings) {
  getStore().set(PROXY_SETTINGS_KEY, value)
  applyProxyEnvironment(value)
  applyProxySession(value)
  refreshNodeProxy()
}
