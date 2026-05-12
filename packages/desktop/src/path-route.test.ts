import { describe, expect, test } from "bun:test"
import { pathRoute, routeInitialPath, type PathTarget } from "./path-route"

describe("desktop path routing", () => {
  test("builds the session route for a filesystem path", () => {
    expect(pathRoute("/tmp/demo")).toBe("/L3RtcC9kZW1v/session")
  })

  test("routes initial path synchronously before app mount", () => {
    let url: string | URL | null | undefined
    const target: PathTarget = {
      __OPENCODE__: { initialPath: "/tmp/demo" },
      history: {
        replaceState(_data, _title, next) {
          url = next
        },
      },
    }

    expect(routeInitialPath(target)).toBe("/tmp/demo")
    expect(target.__OPENCODE__?.initialPath).toBeNull()
    expect(url).toBe("/L3RtcC9kZW1v/session")
  })
})
