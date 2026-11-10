// The parts of SolidStart's file routes (FileRoutes) that preloading uses.
type Route = {
  component?: { preload?: () => unknown }
  $component?: { import: () => Promise<unknown> }
  children?: Route[]
}

const quiet = new WeakSet<object>()
// Stylesheets that preloads added between navigations, held off until the next navigation starts.
const held = new Set<HTMLLinkElement>()
// True until the first page has rendered, and from the start of each navigation until it settles.
let navigating = true

/**
 * SolidStart reloads the page when a route's code fails to load (reloadOnRouteChunkError), so a page
 * left open across a deploy picks up the new build. The router's preloads (a link hovered, focused or
 * touched) run the same loader, so one that failed on a flaky connection reloaded the page under the
 * reader, and one that Safari or Firefox cancelled as the reader followed a link to another page
 * reloaded the page they were leaving instead. Here a
 * route's preload loads its code without that reload and hands it to the route once it has loaded;
 * one that fails leaves the route as it was, to load (and recover) when it's opened.
 *
 * Loading a route's code also adds its stylesheets (Vite's preload helper does, and never again for
 * the same file). Added between navigations, they would restyle the page being read with another
 * page's rules, at once and again whenever it changes, so they're held off (media "not all": fetched
 * and parsed, never applied) until a navigation starts (setNavigating).
 */
export function quietPreloads<T extends Route>(routes: T[]) {
  routes.forEach((route) => {
    if (route.children) quietPreloads(route.children)
    const component = route.component
    const load = route.$component?.import
    const preload = component?.preload
    if (!component || !load || !preload || quiet.has(component)) return
    quiet.add(component)
    component.preload = () => {
      const before = navigating ? undefined : new Set(document.querySelectorAll('link[rel="stylesheet"]'))
      const loading = load()
      // The helper adds the stylesheets synchronously, before any of them has loaded or applied.
      if (before)
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((link) => {
          if (before.has(link)) return
          link.media = "not all"
          held.add(link)
        })
      return loading.then(
        () => preload(),
        () => undefined,
      )
    }
  })
  return routes
}

/**
 * Whether a navigation is under way (from the router's beforeLeave until it settles). The page being
 * opened needs its stylesheets, so a navigation's start applies every held one, before the router
 * renders the page, and preloads add theirs as before until it settles.
 */
export function setNavigating(on: boolean) {
  navigating = on
  if (!on) return
  held.forEach((link) => link.removeAttribute("media"))
  held.clear()
}
