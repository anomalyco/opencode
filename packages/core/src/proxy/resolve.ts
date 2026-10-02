export * as ProxyResolve from "./resolve"

import type { ConfigProxy } from "../config/proxy"

export type ProxyAuth = "auto" | "negotiate" | "ntlm" | "basic" | "none"

export interface ProxySettings {
  url?: URL
  auth: ProxyAuth
  username?: string
  password?: string
  no_proxy?: string
}

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 }

export function resolve(input: {
  config?: ConfigProxy.Info
  env?: Record<string, string | undefined>
  target: string | URL
}): ProxySettings {
  const target = typeof input.target === "string" ? new URL(input.target) : input.target
  const config = input.config
  const env = input.env ?? process.env
  const auth = config?.auth ?? "auto"
  const noProxy = [config?.no_proxy, envValue(env, "no_proxy")].filter(Boolean).join(",")
  const port = Number.parseInt(target.port) || DEFAULT_PORTS[target.protocol.replace(":", "")] || 0
  const direct = { auth, ...(noProxy ? { no_proxy: noProxy } : {}) }

  if (isLoopback(target.hostname) || shouldBypass(target.hostname, port, noProxy)) return direct

  const raw = config?.url || proxyFromEnv(target, env)
  if (!raw) return direct

  const url = new URL(raw.includes("://") ? raw : `${target.protocol}//${raw}`)
  const username = config?.username ?? (url.username ? decodeURIComponent(url.username) : undefined)
  const password = expandEnv(
    config?.password ?? (url.password ? decodeURIComponent(url.password) : undefined),
    env,
  )
  const clean = new URL(url.toString())
  clean.username = ""
  clean.password = ""
  return { url: clean, auth, username, password, ...(noProxy ? { no_proxy: noProxy } : {}) }
}

/** Expand a single `{env:VAR}` placeholder so secrets stay out of config files. */
function expandEnv(value: string | undefined, env: Record<string, string | undefined>): string | undefined {
  if (!value) return value
  const match = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)
  return match ? (env[match[1]] ?? "") : value
}

export function isLoopback(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase()
  if (name === "localhost" || name === "::1" || name === "0:0:0:0:0:0:0:1") return true
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(name)
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped ? mapped[1] : name)
  return match ? Number(match[1]) === 127 : false
}

function proxyFromEnv(target: URL, env: Record<string, string | undefined>): string | undefined {
  const protocol = target.protocol.replace(":", "")
  return envValue(env, `${protocol}_proxy`) || envValue(env, "all_proxy") || undefined
}

function shouldBypass(hostname: string, port: number, noProxy: string): boolean {
  if (!noProxy) return false
  if (noProxy.trim() === "*") return true
  return noProxy.split(/[,\s]/).some((entry) => {
    if (!entry) return false
    const parsed = /^(.+):(\d+)$/.exec(entry)
    const name = (parsed ? parsed[1] : entry).toLowerCase()
    const entryPort = parsed ? Number.parseInt(parsed[2]) : 0
    if (entryPort && entryPort !== port) return false
    return matchesHost(hostname.toLowerCase(), name)
  })
}

function matchesHost(hostname: string, name: string): boolean {
  if (name.startsWith("*.")) return hostname.endsWith(name.slice(1)) || hostname === name.slice(2)
  if (name.startsWith(".")) return hostname.endsWith(name)
  return hostname === name
}

function envValue(env: Record<string, string | undefined>, key: string): string {
  return env[key.toLowerCase()] ?? env[key.toUpperCase()] ?? ""
}
