import type { ProxySettings } from "@opencode/app/desktop"
import { Option, Schema } from "effect"

const loopback = "127.0.0.1,localhost,::1"

const StoredProxySettings = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  http: Schema.optional(Schema.String),
  https: Schema.optional(Schema.String),
  noProxy: Schema.optional(Schema.String),
})

export const defaultProxySettings: ProxySettings = { enabled: false, http: "", https: "", noProxy: "" }

export function readProxySettings(value: Schema.Json | undefined): ProxySettings {
  const decoded = Option.getOrElse(Schema.decodeUnknownOption(StoredProxySettings)(value), () => defaultProxySettings)

  return {
    enabled: decoded.enabled ?? defaultProxySettings.enabled,
    http: decoded.http ?? defaultProxySettings.http,
    https: decoded.https ?? defaultProxySettings.https,
    noProxy: decoded.noProxy ?? defaultProxySettings.noProxy,
  }
}

export function proxyBypass(value: ProxySettings) {
  return [
    ...new Set(
      [value.noProxy, loopback].flatMap((entry) =>
        entry
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean),
      ),
    ),
  ].join(",")
}

export function proxyEnvironment(value: ProxySettings) {
  if (!value.enabled) return {}

  const http = value.http.trim()
  const https = value.https.trim()
  const noProxy = proxyBypass(value)

  return {
    HTTP_PROXY: http,
    http_proxy: http,
    HTTPS_PROXY: https,
    https_proxy: https,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  }
}

export function proxyRules(value: ProxySettings) {
  if (!value.enabled) return undefined

  return value.https.trim() || value.http.trim() || undefined
}
