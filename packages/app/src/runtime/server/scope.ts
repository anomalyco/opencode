import type { ServerConnection } from "@/runtime/server/registry"

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
}

export const SessionStateKey = {
  is(key: string): key is SessionStateKey {
    return key.includes(separator)
  },
  from(scope: ServerScope, route: SessionRouteKey) {
    return compose(scope, [route]) as SessionStateKey
  },
  route(key: string) {
    const split = key.lastIndexOf(separator)
    if (split === -1) throw new Error("Session state key must include server scope")
    return fragment("Session route", key.slice(split + 1)) as SessionRouteKey
  },
  scope(key: string) {
    const split = key.indexOf(separator)
    if (split === -1) throw new Error("Session state key must include server scope")
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
