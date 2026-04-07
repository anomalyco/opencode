const proxyEnvVarNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] as const

export function online() {
  const nav = globalThis.navigator
  if (!nav || typeof nav.onLine !== "boolean") return true
  return nav.onLine
}

export function proxied() {
  return activeProxyEnvVars().length > 0
}

export function activeProxyEnvVars() {
  return proxyEnvVarNames.filter((name) => process.env[name])
}
