import {
  createBeforeLeave,
  createRouter,
  keepDepth,
  notifyIfNotBlocked,
  saveCurrentDepth,
  type BaseRouterProps,
} from "@solidjs/router"

/**
 * Router for an app served under `base` (e.g. `/opencode`): the app sees paths without the prefix, the address bar
 * keeps it. Solid's own `base` prop only affects route matching, so `useLocation()` would still include the prefix.
 *
 * Mirrors `Router` from `@solidjs/router` 1.0, minus link-click handling, which the library does not export. The app
 * navigates in code; an `<A>` added here would reload the page instead.
 */
export function basePathRouter(base: string) {
  const strip = (pathname: string) => {
    if (pathname === base) return "/"

    return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname
  }

  const source = () => {
    const state = window.history.state

    return {
      value: strip(window.location.pathname) + window.location.search + window.location.hash,
      // The router stamps its own history depth into the state; that alone is not app state.
      state: state && state._depth && Object.keys(state).length === 1 ? undefined : state,
    }
  }

  return (props: BaseRouterProps) => {
    const beforeLeave = createBeforeLeave()

    return createRouter({
      get: source,
      set(next) {
        const url = base + next.value

        if (next.replace) window.history.replaceState(keepDepth(next.state), "", url)

        if (!next.replace) window.history.pushState(next.state, "", url)
        saveCurrentDepth()
        scrollAfterNavigation(next.scroll)
      },
      init(notify) {
        const handler = notifyIfNotBlocked(notify, (delta) => {
          if (delta) return !beforeLeave.confirm(delta)
          const current = source()

          return !beforeLeave.confirm(current.value, { state: current.state })
        })

        window.addEventListener("popstate", handler)

        return () => window.removeEventListener("popstate", handler)
      },
      utils: {
        go: (delta) => window.history.go(delta),
        renderPath: (path) => base + path,
        beforeLeave,
      },
    })(props)
  }
}

// Bring the element the new hash names into view, or go to the top when the navigation asks for it.
function scrollAfterNavigation(top: boolean | undefined) {
  const target = decodeURIComponent(window.location.hash.slice(1))
  const element = target ? document.getElementById(target) : null

  if (element) return element.scrollIntoView()

  if (top) window.scrollTo(0, 0)
}
