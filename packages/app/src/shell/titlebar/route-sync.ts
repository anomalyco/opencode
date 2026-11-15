import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { useLayout } from "@/shell/state/layout"
import { useGlobal } from "@/runtime/server/runtime"
import { useTabs } from "@/shell/tabs/tabs"
import { rootSession } from "@/shell/routes/session"
import {
  cachedRootID,
  INITIAL_ROUTE_TAB_STATE,
  transitionRouteTab,
  type RouteTabEffect,
  type RouteTabEvent,
  type RouteTarget,
} from "./route-machine"

// A root lookup that has not answered by then counts as failed, so the route can still take a tab once it resolves.
const RESOLVE_TIMEOUT_MS = 15_000

/** Keeps the tab strip in step with the route: finds the tab that shows it, and adds or remembers that tab. */
export function createRouteTabSync() {
  const layout = useLayout()
  const global = useGlobal()
  const tabs = useTabs()
  const [routeState, setRouteState] = createSignal(INITIAL_ROUTE_TAB_STATE)
  const lookups = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const preparing = createMemo(() => {
    const route = layout.route()

    return route.type === "session" && !!tabs.pendingSession(route.server, route.sessionId)
  })

  const session = createMemo(() => {
    const route = layout.route()

    if (route.type !== "session" || preparing()) return

    return global.serverCtx(route.server)?.data.session.get(route.sessionId)
  })

  const currentTab = createMemo(() => {
    const route = layout.route()

    if (route.type === "draft")
      return tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)

    if (route.type !== "session") return
    const direct = tabs.sessionTab(route.server, route.sessionId)

    if (direct) return direct
    const parentID = session()?.parentID

    if (!parentID) return
    const ancestor = global.serverCtx(route.server)?.data.session.root(route.sessionId)

    return (ancestor ? tabs.sessionTab(route.server, ancestor) : undefined) ?? tabs.sessionTab(route.server, parentID)
  })

  const dispatch = (event: RouteTabEvent) =>
    untrack(() => {
      const previous = routeState()
      const result = transitionRouteTab(previous, event)

      if (result.state !== previous) setRouteState(result.state)
      result.effects.forEach(run)
    })

  const run = (effect: RouteTabEffect) => {
    if (effect.type === "session.resolve") {
      resolve(effect.attempt, effect.target)

      return
    }

    if (effect.type === "attempt.abort") {
      const lookup = lookups.get(effect.attempt)

      if (!lookup) return
      clearTimeout(lookup.timer)
      lookup.controller.abort()
      lookups.delete(effect.attempt)

      return
    }

    if (effect.type === "tab.add") {
      tabs.addSessionTab({ server: effect.server, sessionId: effect.sessionID })

      return
    }

    if (effect.type === "tab.route") {
      tabs.rememberSessionRoute(effect.tab, effect.sessionID, effect.parentID)

      return
    }

    tabs.remember(effect.tab)
  }

  const resolve = (attempt: number, target: RouteTarget) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS)
    lookups.set(attempt, { controller, timer })

    const lookup = async () => {
      const ctx = global.serverCtx(target.server)

      if (!ctx) throw new Error("Server is not connected")

      const fetch = async (sessionID: string) => {
        const info = await ctx.sdk.api.session.get({ sessionID }, { signal: controller.signal })
        ctx.data.session.remember(info)

        return info
      }

      // The routed session is always refreshed; its ancestors come from the cache when they are there.
      const info = await fetch(target.sessionID).catch(() => ctx.data.session.get(target.sessionID))

      if (!info) throw new Error("Session not found")

      return rootSession(info, (sessionID) => {
        const cached = ctx.data.session.get(sessionID)

        return cached ? Promise.resolve(cached) : fetch(sessionID)
      })
    }

    // A stale or aborted attempt's result is rejected by the machine.
    void lookup()
      .then(
        (root) => ({ type: "resolve.succeeded", attempt, target, rootID: root.id }) as const,
        () => ({ type: "resolve.failed", attempt, target }) as const,
      )
      .then((event) => {
        clearTimeout(timer)
        lookups.delete(attempt)
        dispatch(event)
      })
  }

  createEffect(() => {
    const route = layout.route()
    const ctx = route.type === "session" ? global.serverCtx(route.server) : undefined

    dispatch({
      type: "sync",
      snapshot: {
        route,
        ready: tabs.ready(),
        tab: currentTab(),
        preview: tabs.preview(),
        recentKey: tabs.recentKey(),
        pending: preparing(),
        session: session(),
        rootID:
          route.type !== "session"
            ? undefined
            : preparing()
              ? route.sessionId
              : ctx && cachedRootID(route.sessionId, (id) => ctx.data.session.get(id)),
        serverReady: !!ctx,
      },
    })
  })

  onCleanup(() => dispatch({ type: "dispose" }))

  return { currentTab, session, preparing }
}
