import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test"
import { createWebFetch } from "./web-fetch"

const worker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")

const href = location.href

afterEach(() => {
  mock.restore()
  setSystemTime()
  sessionStorage.clear()
  location.href = href

  if (worker) return Object.defineProperty(navigator, "serviceWorker", worker)
  // eslint-disable-next-line no-restricted-globals -- Restore the browser property's original absence.
  Reflect.deleteProperty(navigator, "serviceWorker")
})

test.each(["unauthorized", "redirect"])(
  "%s recovery waits for worker removal and requires a healthy return to rearm",
  async (kind) => {
    location.href = "https://opencode.example/"
    setSystemTime(new Date("2026-10-21T12:00:00Z"))
    const removal = Promise.withResolvers<boolean>()
    const unregister = mock(() => removal.promise)
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: async () => ({ unregister }) },
    })
    const navigate = spyOn(location, "replace").mockImplementation(() => {})
    // Opaque redirect responses can only be created by a browser's network stack.
    const failure =
      kind === "unauthorized"
        ? new Response(null, { status: 401 })
        : Object.defineProperty(Response.error(), "type", { value: "opaqueredirect" })
    const request = spyOn(globalThis, "fetch").mockResolvedValue(failure)
    const platform = { fetch: createWebFetch() }

    await platform.fetch("https://other.example/api/info")
    expect(request.mock.calls.at(-1)?.[1]).toBeUndefined()
    await platform.fetch(`${location.origin}/apiary`)
    expect(request.mock.calls.at(-1)?.[1]).toBeUndefined()
    expect(unregister).not.toHaveBeenCalled()
    const first = platform.fetch(new Request(`${location.origin}/api/info`), { credentials: "include" })
    expect(request.mock.calls.at(-1)?.[1]).toEqual({ credentials: "include", redirect: "manual" })
    await platform.fetch(`${location.origin}/api/project`)
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    removal.resolve(true)
    expect(await first).toBe(failure)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(`/?auth_refresh=${Date.now()}`)

    const reloaded = createWebFetch()
    setSystemTime(new Date("2026-10-21T13:00:00Z"))
    await reloaded(`${location.origin}/api/info`)
    expect(navigate).toHaveBeenCalledTimes(1)

    request.mockResolvedValue(new Response(null, { status: 200 }))
    await reloaded(`${location.origin}/api/project`)
    request.mockResolvedValue(failure)
    await reloaded(`${location.origin}/api/info`)
    expect(navigate).toHaveBeenCalledTimes(1)

    request.mockResolvedValue(new Response(null, { status: 200 }))
    expect((await reloaded(`${location.origin}/api/info`)).status).toBe(200)
    expect(navigate).toHaveBeenCalledTimes(1)
    request.mockResolvedValue(failure)
    await reloaded(`${location.origin}/api/info`)
    expect(navigate).toHaveBeenCalledTimes(2)
  },
)
