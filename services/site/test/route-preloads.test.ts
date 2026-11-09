import { describe, expect, test } from "bun:test"
import { quietPreloads } from "~/lib/route-preloads"

// A file route as SolidStart builds it: a lazy component whose preload is the reloading loader, and
// the route's own import of its code.
function route(code: () => Promise<unknown>) {
  const calls = { preload: 0, import: 0 }
  return {
    calls,
    route: {
      component: { preload: () => void calls.preload++ },
      $component: {
        import: () => {
          calls.import++
          return code()
        },
      },
    },
  }
}

describe("quietPreloads", () => {
  test("hands a route its code once the code has loaded", async () => {
    const page = route(() => Promise.resolve({}))
    quietPreloads([page.route])

    await page.route.component.preload()

    expect(page.calls).toEqual({ preload: 1, import: 1 })
  })

  test("leaves the route as it was when its code fails to load", async () => {
    const page = route(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")))
    quietPreloads([page.route])

    expect(await page.route.component.preload()).toBeUndefined()
    expect(page.calls).toEqual({ preload: 0, import: 1 })
  })

  // quietPreloads relies on the shape SolidStart gives each file route, and skips any route without
  // it, so a SolidStart or Solid upgrade that changes it would turn the fix off without a sound. If
  // one of these fails, check that preloads still can't reload the page (src/lib/route-preloads.ts),
  // then update the expectations.
  test("SolidStart's file routes still have the shape it relies on", async () => {
    const start = (file: string) =>
      Bun.file(new URL(`../node_modules/@solidjs/start/dist/${file}`, import.meta.url)).text()
    // The route's own import of its code, unwrapped: `$component: { src, build, import }`.
    expect(await start("config/fs-routes/index.js")).toContain("import: `_$() => import('${buildId}')$_`")
    const router = await start("router.jsx")
    // Each route keeps its `$component`, and its component is a lazy one over the reloading loader.
    expect(router).toContain("...route,")
    expect(router).toContain("lazy(loadComponent(route))")
    expect(router).toContain("withRouteChunkReload(route.$component.import)")
    // The router preloads a route through its component's `preload`, which a lazy component has.
    expect(await Bun.file(new URL("../node_modules/@solidjs/router/dist/index.js", import.meta.url)).text()).toContain(
      "route.component && route.component.preload && route.component.preload()",
    )
    expect(await Bun.file(new URL("../node_modules/solid-js/dist/solid.js", import.meta.url)).text()).toContain(
      "wrap.preload = () =>",
    )
  })

  test("reaches nested routes and wraps each preload once", async () => {
    const page = route(() => Promise.resolve({}))
    const routes = [{ children: [page.route] }]
    quietPreloads(routes)
    quietPreloads(routes)

    await page.route.component.preload()

    expect(page.calls).toEqual({ preload: 1, import: 1 })
  })
})
