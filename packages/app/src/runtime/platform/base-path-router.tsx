import {
  type BaseRouterProps,
  createBeforeLeave,
  createRouter,
  keepDepth,
  notifyIfNotBlocked,
  saveCurrentDepth,
} from "@solidjs/router"
import { basePath, stripBasePath, withBasePath } from "@/runtime/platform/base-path"

/**
 * A history router for builds served under a base path. Unlike the router's own `base`, it keeps every route path the
 * app sees base-free, so code reading `useLocation().pathname` or navigating to it works the same under any base.
 */
export function BasePathRouter(props: BaseRouterProps) {
  const read = () => {
    const state = history.state

    return {
      value: stripBasePath(location.pathname + location.search + location.hash),
      // The router marks its own entries with only a depth; that is not app state.
      state: state && state._depth && Object.keys(state).length === 1 ? undefined : state,
    }
  }

  const beforeLeave = createBeforeLeave()

  return createRouter({
    get: read,
    set({ value, replace, scroll, state }) {
      const url = withBasePath(value)

      if (replace) history.replaceState(keepDepth(state), "", url)
      else history.pushState(state, "", url)

      const hash = decodeURIComponent(location.hash.slice(1))
      const target = hash && document.getElementById(hash)

      if (target) target.scrollIntoView()
      else if (scroll) window.scrollTo(0, 0)

      saveCurrentDepth()
    },
    init: (notify) => {
      const handler = notifyIfNotBlocked(notify, (delta) => {
        if (delta) return !beforeLeave.confirm(delta)

        const source = read()

        return !beforeLeave.confirm(source.value, { state: source.state })
      })

      window.addEventListener("popstate", handler)

      return () => window.removeEventListener("popstate", handler)
    },
    utils: {
      go: (delta) => history.go(delta),
      renderPath: withBasePath,
      parsePath: stripBasePath,
      beforeLeave,
    },
  })(props)
}

export const baseRouter = basePath ? BasePathRouter : undefined
