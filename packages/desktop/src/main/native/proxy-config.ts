import type { ProxySettings } from "@opencode/app/desktop"
import { Option, Schema } from "effect"

const loopback = "127.0.0.1,localhost,::1"

export const proxyKeys = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
] as const

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

export function proxyBypass(value: ProxySettings, ...extra: (string | undefined)[]) {
  return [
    ...new Set(
      [value.noProxy, loopback, ...extra].flatMap((entry) =>
        (entry ?? "")
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean),
      ),
    ),
  ].join(",")
}

export function proxyEnvironment(value: ProxySettings, existing: Readonly<Record<string, string | undefined>> = {}) {
  if (!value.enabled) return {}

  const environment: Record<string, string> = {}
  const http = value.http.trim()
  const https = value.https.trim()

  if (http) {
    environment.HTTP_PROXY = http
    environment.http_proxy = http
  }

  if (https) {
    environment.HTTPS_PROXY = https
    environment.https_proxy = https
  }

  const noProxy = proxyBypass(value, existing.NO_PROXY, existing.no_proxy)

  if (noProxy) {
    environment.NO_PROXY = noProxy
    environment.no_proxy = noProxy
  }

  return environment
}

export function proxyRules(value: ProxySettings) {
  if (!value.enabled) return undefined

  return value.https.trim() || value.http.trim() || undefined
}
