import type { ServerConnection } from "@/context/server"

export type ServerScope = string & { readonly __brand: "ServerScope" }
export type SessionRouteKey = string & { readonly __brand: "SessionRouteKey" }
export type SessionStateKey = string & { readonly __brand: "SessionStateKey" }
export type ScopedKey = string & { readonly __brand: "ScopedKey" }

const separator = "\u0000"

function fragment(label: string, value: string) {
  if (value.includes(separator)) throw new Error(`${label} cannot contain null bytes`)
  return value
}

function compose(scope: ServerScope, parts: string[]) {
  return [fragment("Server scope", scope), ...parts.map((part) => fragment("Scoped key part", part))].join(separator)
}

export const ServerScope = {
  local: "local" as ServerScope,
  fromServerKey(key: ServerConnection.Key, canonicalLocalServer?: ServerConnection.Key) {
    return fragment(
      "Server scope",
      key === "sidecar" || key === canonicalLocalServer ? ServerScope.local : key,
    ) as ServerScope
  },
}

export const SessionRouteKey = {
  fromRoute(dir: string | undefined, sessionID?: string) {
    return fragment("Session route", `${dir ?? ""}${sessionID ? "/" + sessionID : ""}`) as SessionRouteKey
  },
  fromLegacy(key: string) {
    return fragment("Legacy session route", key) as SessionRouteKey
  },
}

export const SessionStateKey = {
  from(scope: ServerScope, route: SessionRouteKey) {
    return compose(scope, [route]) as SessionStateKey
  },
  route(key: string) {
    const split = key.lastIndexOf(separator)
    return SessionRouteKey.fromLegacy(split === -1 ? key : key.slice(split + 1))
  },
  scope(key: string) {
    const split = key.indexOf(separator)
    if (split === -1) return ServerScope.local
    return fragment("Stored server scope", key.slice(0, split)) as ServerScope
  },
}

export const ScopedKey = {
  from(scope: ServerScope, ...parts: string[]) {
    return compose(scope, parts) as ScopedKey
  },
  prefix(scope: ServerScope, ...parts: string[]) {
    return `${ScopedKey.from(scope, ...parts)}${separator}`
  },
}

export function migrateLegacySessionStateKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const entries = Object.entries(value)
  if (entries.every(([key]) => key.includes(separator))) return value
  const scoped = Object.fromEntries(entries.filter(([key]) => key.includes(separator)))
  for (const [key, item] of entries) {
    if (key.includes(separator)) continue
    const next = SessionStateKey.from(ServerScope.local, SessionRouteKey.fromLegacy(key))
    if (!(next in scoped)) scoped[next] = item
  }
  return scoped
}
