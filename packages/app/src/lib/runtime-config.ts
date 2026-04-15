type RuntimeConfig = {
  opencodeServerUrl?: string
  univerBackendUrl?: string
  univerSdkWsUrl?: string
}

declare global {
  interface Window {
    __VERITLY_RUNTIME_CONFIG__?: RuntimeConfig
  }
}

function trimValue(value: string | undefined) {
  const next = value?.trim()
  return next ? next : undefined
}

export function runtimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") return {}
  return window.__VERITLY_RUNTIME_CONFIG__ ?? {}
}

export function runtimeOpencodeServerUrl() {
  return trimValue(runtimeConfig().opencodeServerUrl) ?? trimValue(import.meta.env.VITE_OPENCODE_SERVER_URL)
}

export function runtimeUniverBackendUrl() {
  return trimValue(runtimeConfig().univerBackendUrl) ?? trimValue(import.meta.env.VITE_UNIVER_BACKEND_URL)
}

export function runtimeUniverSdkWsUrl() {
  return trimValue(runtimeConfig().univerSdkWsUrl) ?? trimValue(import.meta.env.VITE_UNIVER_SDK_WS)
}
