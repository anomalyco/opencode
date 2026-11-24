import { Predicate } from "effect"
import type { Accessor } from "solid-js"
import type { ServerConnection } from "@/runtime/server/registry"
import { SessionStateKey, type ServerScope } from "@/runtime/server/scope"
import type { Tab } from "@/shell/tabs/tabs"

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)

  return key
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = Predicate.isString(sessionKey) ? () => sessionKey : sessionKey

  return () => {
    const value = key()
    ensure(value)

    return value
  }
}

/**
 * The session keys whose stored state the layout forgets: all but the `max` used last. `keep`, the session on screen,
 * and every session `open` in a shell tab stay whatever their rank: their side tabs are on screen, or one click away.
 */
export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
  open?: (key: string) => boolean
}) {
  if (!input.keep) return []

  const keys = Array.from(new Set<string>([...input.view, ...input.tabs]))

  if (keys.length <= input.max) return []

  const held = keys.filter((key) => key === input.keep || input.open?.(key))
  const stored = new Map(keys.map((key, index) => [key, index]))

  return (
    keys
      .filter((key) => !held.includes(key))
      // `used` starts empty with each run, so the keys not used in this one all rank last. Among them the ones stored
      // last stay: the stored order outlives a restart, and the newest sessions are the ones a person returns to.
      .sort((a, b) => (input.used.get(b) ?? 0) - (input.used.get(a) ?? 0) || (stored.get(b) ?? 0) - (stored.get(a) ?? 0))
      .slice(Math.max(0, input.max - held.length))
  )
}

/** Whether the session a layout key belongs to is open in a shell tab, as the session the tab shows or the one it routes. */
export function sessionKeyOpen(key: string, tabs: readonly Tab[], scope: (server: ServerConnection.Key) => ServerScope) {
  const session = SessionStateKey.route(key).split("/")[1]

  return (
    !!session &&
    tabs.some(
      (tab) =>
        tab.type === "session" &&
        (tab.sessionId === session || tab.routeSessionId === session) &&
        scope(tab.server) === SessionStateKey.scope(key),
    )
  )
}
