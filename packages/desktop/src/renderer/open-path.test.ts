import { describe, expect, test } from "bun:test"
import { createOpenPath } from "./open-path"

function api(opts?: {
  resolved?: string | null | Array<string | null>
  resolveError?: Error
  failOpen?: (app: string | undefined) => boolean
}) {
  const calls = {
    resolve: [] as string[],
    open: [] as Array<{ path: string; app?: string }>,
  }
  return {
    calls,
    api: {
      async resolveAppPath(app: string) {
        calls.resolve.push(app)
        if (opts?.resolveError) throw opts.resolveError
        if (Array.isArray(opts?.resolved)) return opts.resolved.shift() ?? null
        if (opts && "resolved" in opts) return opts.resolved
        return `C:\\Tools\\${app}.exe`
      },
      async openPath(path: string, app?: string) {
        calls.open.push({ path, app })
        if (opts?.failOpen?.(app)) throw new Error("open failed")
      },
    },
  }
}

describe("renderer openPath", () => {
  test("reuses resolved Windows app paths across repeated opens", async () => {
    const current = api()
    const openPath = createOpenPath(current.api, "windows")

    await openPath("C:\\repo", "code")
    await openPath("C:\\repo", "code")

    expect(current.calls.resolve).toEqual(["code"])
    expect(current.calls.open).toEqual([
      { path: "C:\\repo", app: "C:\\Tools\\code.exe" },
      { path: "C:\\repo", app: "C:\\Tools\\code.exe" },
    ])
  })

  test("passes non-Windows open requests through without resolving", async () => {
    const current = api()
    const openPath = createOpenPath(current.api, "macos")

    await openPath("/repo", "Visual Studio Code")

    expect(current.calls.resolve).toEqual([])
    expect(current.calls.open).toEqual([{ path: "/repo", app: "Visual Studio Code" }])
  })

  test("falls back to default app when Windows app resolution fails", async () => {
    const current = api({ resolved: null })
    const openPath = createOpenPath(current.api, "windows")

    await openPath("C:\\repo", "missing")

    expect(current.calls.resolve).toEqual(["missing"])
    expect(current.calls.open).toEqual([{ path: "C:\\repo", app: undefined }])
  })

  test("falls back to default app when Windows app resolution rejects", async () => {
    const current = api({ resolveError: new Error("resolver failed") })
    const openPath = createOpenPath(current.api, "windows")

    await openPath("C:\\repo", "missing")

    expect(current.calls.resolve).toEqual(["missing"])
    expect(current.calls.open).toEqual([{ path: "C:\\repo", app: undefined }])
  })

  test("does not cache missing Windows app resolutions", async () => {
    const current = api({ resolved: [null, "C:\\Tools\\Installed.exe"] })
    const openPath = createOpenPath(current.api, "windows")

    await openPath("C:\\repo", "late-code")
    await openPath("C:\\repo", "late-code")

    expect(current.calls.resolve).toEqual(["late-code", "late-code"])
    expect(current.calls.open).toEqual([
      { path: "C:\\repo", app: undefined },
      { path: "C:\\repo", app: "C:\\Tools\\Installed.exe" },
    ])
  })

  test("invalidates cached Windows app paths after open failure", async () => {
    let oldOpens = 0
    const current = api({
      resolved: ["C:\\Tools\\Old.exe", "C:\\Tools\\New.exe"],
      failOpen: (app) => app === "C:\\Tools\\Old.exe" && ++oldOpens > 1,
    })
    const openPath = createOpenPath(current.api, "windows")

    await openPath("C:\\repo", "moving-code")
    await openPath("C:\\repo", "moving-code")

    expect(current.calls.resolve).toEqual(["moving-code", "moving-code"])
    expect(current.calls.open).toEqual([
      { path: "C:\\repo", app: "C:\\Tools\\Old.exe" },
      { path: "C:\\repo", app: "C:\\Tools\\Old.exe" },
      { path: "C:\\repo", app: "C:\\Tools\\New.exe" },
    ])
  })

  test("falls back to default app when stale cached Windows app paths cannot be re-resolved", async () => {
    let oldOpens = 0
    const current = api({
      resolved: ["C:\\Tools\\Old.exe", null],
      failOpen: (app) => app === "C:\\Tools\\Old.exe" && ++oldOpens > 1,
    })
    const openPath = createOpenPath(current.api, "windows")

    await openPath("C:\\repo", "moving-code")
    await openPath("C:\\repo", "moving-code")

    expect(current.calls.resolve).toEqual(["moving-code", "moving-code"])
    expect(current.calls.open).toEqual([
      { path: "C:\\repo", app: "C:\\Tools\\Old.exe" },
      { path: "C:\\repo", app: "C:\\Tools\\Old.exe" },
      { path: "C:\\repo", app: undefined },
    ])
  })

  test("bounds cached Windows app paths across many unique apps", async () => {
    const current = api()
    const openPath = createOpenPath(current.api, "windows")

    for (const index of Array.from({ length: 33 }, (_, index) => index)) {
      await openPath("C:\\repo", `bounded-code-${index}`)
    }
    await openPath("C:\\repo", "bounded-code-0")

    expect(current.calls.resolve.filter((app) => app === "bounded-code-0")).toHaveLength(2)
  })
})
