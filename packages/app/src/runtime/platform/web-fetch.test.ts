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

test("same-origin 401 recovery waits for worker removal and suppresses concurrent and repeated reloads", async () => {
  location.href = "https://opencode.example/"
  setSystemTime(new Date("2026-10-21T12:00:00Z"))
  const removal = Promise.withResolvers<boolean>()
  const unregister = mock(() => removal.promise)
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => ({ unregister }) },
  })
  const navigate = spyOn(location, "replace").mockImplementation(() => {})
  const request = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }))
  const platform = { fetch: createWebFetch() }

  await platform.fetch("https://other.example/api/info")
  expect(unregister).not.toHaveBeenCalled()
  const first = platform.fetch(`${location.origin}/api/info`)
  await platform.fetch(`${location.origin}/api/project`)
  expect(unregister).toHaveBeenCalledTimes(1)
  expect(navigate).not.toHaveBeenCalled()
  removal.resolve(true)
  expect((await first).status).toBe(401)
  expect(navigate).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledWith(`/?auth_refresh=${Date.now()}`)

  const reloaded = createWebFetch()
  await reloaded(`${location.origin}/api/info`)
  expect(navigate).toHaveBeenCalledTimes(1)

  request.mockResolvedValue(new Response(null, { status: 200 }))
  expect((await reloaded(`${location.origin}/api/info`)).status).toBe(200)
  expect(navigate).toHaveBeenCalledTimes(1)
})
