// The parts of SolidStart's file routes (FileRoutes) that preloading uses.
type Route = {
  component?: { preload?: () => unknown }
  $component?: { import: () => Promise<unknown> }
  children?: Route[]
}

const quiet = new WeakSet<object>()

/**
 * SolidStart reloads the page when a route's code fails to load (reloadOnRouteChunkError), so a page
 * left open across a deploy picks up the new build. The router's preloads (a link hovered, focused or
 * touched, or scrolled into view on a touch screen) run the same loader, so one that failed on a
 * flaky connection reloaded the page under the reader, and one that Safari or Firefox cancelled as
 * the reader followed a link to another page reloaded the page they were leaving instead. Here a
 * route's preload loads its code without that reload and hands it to the route once it has loaded;
 * one that fails leaves the route as it was, to load (and recover) when it's opened.
 */
export function quietPreloads<T extends Route>(routes: T[]) {
  routes.forEach((route) => {
    if (route.children) quietPreloads(route.children)
    const component = route.component
    const load = route.$component?.import
    const preload = component?.preload
    if (!component || !load || !preload || quiet.has(component)) return
    quiet.add(component)
    component.preload = () =>
      load().then(
        () => preload(),
        () => undefined,
      )
  })
  return routes
}
