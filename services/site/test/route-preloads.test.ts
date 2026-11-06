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

  test("reaches nested routes and wraps each preload once", async () => {
    const page = route(() => Promise.resolve({}))
    const routes = [{ children: [page.route] }]
    quietPreloads(routes)
    quietPreloads(routes)

    await page.route.component.preload()

    expect(page.calls).toEqual({ preload: 1, import: 1 })
  })
})
