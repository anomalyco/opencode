/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { FetchHandler } from "../../../fixture/tui-sdk"
import { json, mount, wait } from "./sync-fixture"

type OverlayCall = { sessionID: string; enabled: boolean }

/**
 * Records every overlay request and answers like the server does (echo the new
 * state), unless `reject` opts a specific call into a failure response.
 */
function recorder(reject?: (call: OverlayCall, index: number) => boolean) {
  const calls: OverlayCall[] = []
  const handler: FetchHandler = async (url, request) => {
    const match = /^\/permission\/session\/([^/]+)\/overlay$/.exec(url.pathname)
    if (!match) return undefined
    const body = (await request.json()) as { enabled: boolean }
    const call = { sessionID: match[1], enabled: body.enabled }
    const index = calls.length
    calls.push(call)
    if (reject?.(call, index)) return json({ error: "overlay unavailable" }, { status: 503 })
    return json(body.enabled)
  }
  return { calls, handler }
}

const session = (sessionID: string) => ({ type: "session" as const, sessionID })

describe("tui review permission overlay", () => {
  test("entering review mode enables the overlay for the routed session", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      expect(calls).toHaveLength(0)
      mounted.permission.set("review")
      await wait(() => calls.length === 1)
      expect(calls[0]).toEqual({ sessionID: "ses_auto", enabled: true })
      expect(mounted.permission.mode).toBe("review")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("leaving review mode disables the overlay", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      mounted.permission.set("review")
      await wait(() => calls.length === 1)
      mounted.permission.set("normal")
      await wait(() => calls.length === 2)
      expect(calls[1]).toEqual({ sessionID: "ses_auto", enabled: false })
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("toggling out of review mode disables the overlay", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      mounted.permission.set("review")
      await wait(() => calls.length === 1)
      mounted.permission.toggle()
      expect(mounted.permission.mode).toBe("normal")
      await wait(() => calls.length === 2)
      expect(calls[1]).toEqual({ sessionID: "ses_auto", enabled: false })
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("switching sessions moves the overlay", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      mounted.permission.set("review")
      await wait(() => calls.length === 1)
      mounted.route.navigate(session("ses_other"))
      await wait(() => calls.length === 3)
      expect(calls[1]).toEqual({ sessionID: "ses_auto", enabled: false })
      expect(calls[2]).toEqual({ sessionID: "ses_other", enabled: true })
      expect(mounted.permission.mode).toBe("review")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("navigating away from every session releases the overlay", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      mounted.permission.set("review")
      await wait(() => calls.length === 1)
      mounted.route.navigate({ type: "home" })
      await wait(() => calls.length === 2)
      expect(calls[1]).toEqual({ sessionID: "ses_auto", enabled: false })
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("instance disposal re-attaches the overlay", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      mounted.permission.set("review")
      await wait(() => calls.length === 1)
      mounted.emit({
        directory: "/tmp/opencode/packages/tui",
        project: "proj_test",
        payload: {
          id: "evt_disposed_overlay",
          type: "server.instance.disposed",
          properties: { directory: "/tmp/opencode/packages/tui" },
        },
      })
      await wait(() => calls.length === 2)
      expect(calls[1]).toEqual({ sessionID: "ses_auto", enabled: true })
      expect(mounted.permission.mode).toBe("review")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("instance disposal in another directory leaves the overlay alone", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      mounted.permission.set("review")
      await wait(() => calls.length === 1)
      mounted.emit({
        directory: "/tmp/opencode/packages/other",
        project: "proj_other",
        payload: {
          id: "evt_disposed_other",
          type: "server.instance.disposed",
          properties: { directory: "/tmp/opencode/packages/other" },
        },
      })
      await Bun.sleep(50)
      expect(calls).toHaveLength(1)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("a failed enable drops back to normal mode and reports it", async () => {
    const { calls, handler } = recorder((call) => call.enabled)
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      mounted.permission.set("review")
      await wait(() => mounted.permission.mode === "normal")
      expect(calls).toEqual([{ sessionID: "ses_auto", enabled: true }])
      expect(mounted.toast.currentToast?.variant).toBe("error")
      expect(mounted.toast.currentToast?.title).toBe("Auto-approve unavailable")
      // Nothing was ever enabled, so there is nothing to tear down.
      await Bun.sleep(50)
      expect(calls).toHaveLength(1)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("a failed disable keeps retrying until the server accepts it", async () => {
    process.env["OPENCODE_TUI_REVIEW_OVERLAY_RETRY_MS"] = "20"
    const { calls, handler } = recorder((call, index) => !call.enabled && index < 3)
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      mounted.permission.set("review")
      await wait(() => calls.length === 1)
      mounted.permission.set("normal")
      await wait(() => calls.length === 4, 5_000)
      expect(calls.slice(1)).toEqual([
        { sessionID: "ses_auto", enabled: false },
        { sessionID: "ses_auto", enabled: false },
        { sessionID: "ses_auto", enabled: false },
      ])
      // The successful fourth attempt is the last one.
      await Bun.sleep(150)
      expect(calls).toHaveLength(4)
      expect(mounted.permission.mode).toBe("normal")
    } finally {
      delete process.env["OPENCODE_TUI_REVIEW_OVERLAY_RETRY_MS"]
      mounted.app.renderer.destroy()
    }
  }, 10_000)

  test("a hung overlay request is treated as a failed enable", async () => {
    process.env["OPENCODE_TUI_REVIEW_OVERLAY_TIMEOUT_MS"] = "100"
    const mounted = await mount(
      (url) => {
        if (url.pathname.endsWith("/overlay")) return new Promise<Response>(() => {})
      },
      undefined,
      {},
      { route: session("ses_auto") },
    )

    try {
      mounted.permission.set("review")
      await wait(() => mounted.permission.mode === "normal", 5_000)
      expect(mounted.toast.currentToast?.title).toBe("Auto-approve unavailable")
    } finally {
      delete process.env["OPENCODE_TUI_REVIEW_OVERLAY_TIMEOUT_MS"]
      mounted.app.renderer.destroy()
    }
  }, 10_000)

  test("normal mode never touches the overlay", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: session("ses_auto") })

    try {
      expect(mounted.permission.mode).toBe("normal")
      mounted.route.navigate(session("ses_other"))
      await Bun.sleep(50)
      expect(calls).toHaveLength(0)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("legacy --auto never touches the overlay", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, { auto: true }, { route: session("ses_auto") })

    try {
      expect(mounted.permission.mode).toBe("auto")
      mounted.route.navigate(session("ses_other"))
      await Bun.sleep(50)
      expect(calls).toHaveLength(0)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("attach enables the overlay for a session the route has not reached yet", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: { type: "home" } })

    try {
      mounted.permission.set("review")
      await Bun.sleep(30)
      expect(calls).toHaveLength(0)

      await mounted.permission.attach("ses_created")
      // Awaiting attach must be enough; the caller sends its prompt right after.
      expect(calls).toEqual([{ sessionID: "ses_created", enabled: true }])

      mounted.route.navigate(session("ses_created"))
      await Bun.sleep(50)
      expect(calls).toHaveLength(1)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("attach is a no-op outside review mode", async () => {
    const { calls, handler } = recorder()
    const mounted = await mount(handler, undefined, {}, { route: { type: "home" } })

    try {
      await mounted.permission.attach("ses_created")
      expect(calls).toHaveLength(0)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("a failed enable from attach drops back to normal mode", async () => {
    const { calls, handler } = recorder((call) => call.enabled)
    const mounted = await mount(handler, undefined, {}, { route: { type: "home" } })

    try {
      mounted.permission.set("review")
      await mounted.permission.attach("ses_created")
      expect(calls).toEqual([{ sessionID: "ses_created", enabled: true }])
      expect(mounted.permission.mode).toBe("normal")
      expect(mounted.toast.currentToast?.variant).toBe("error")
    } finally {
      mounted.app.renderer.destroy()
    }
  })
})
