import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test"
import { createWebFetch } from "./web-fetch"

const href = location.href

afterEach(() => {
  mock.restore()
  setSystemTime()
  sessionStorage.clear()
  location.href = href
})

test("proxy 401s trigger one recovery while preserving the route, query, hash, and prefix", async () => {
  location.href = "https://opencode.example/tools/opencode/workspace/session?view=diff#message"
  const navigate = spyOn(location, "replace").mockImplementation(() => {})
  spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }))
  const request = createWebFetch()

  await Promise.all([request("/tools/opencode/api/info"), request("/tools/opencode/api/project")])
  expect(navigate).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledWith(
    "https://opencode.example/tools/opencode/workspace/session?view=diff&reauth=1#message",
  )

  setSystemTime(new Date(Date.now() + 3_600_000))
  await createWebFetch()("/tools/opencode/api/info")
  expect(navigate).toHaveBeenCalledTimes(1)
})

test("OpenCode password challenges keep their readable body and never navigate", async () => {
  location.href = "https://opencode.example/workspace/session"
  const navigate = spyOn(location, "replace").mockImplementation(() => {})
  const body = { _tag: "UnauthorizedError", message: "Authentication required" }
  spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(body, { status: 401 }))
    .mockResolvedValueOnce(Response.json(body, { status: 401 }))
  const request = createWebFetch()

  expect(await (await request("/api/info")).json()).toEqual(body)
  await request("/api/info")
  expect(navigate).not.toHaveBeenCalled()
  expect(sessionStorage.getItem("opencode.auth-refresh")).toBeNull()
})

test("API redirects are intercepted without losing Request or init options", async () => {
  location.href = "https://opencode.example/"
  const navigate = spyOn(location, "replace").mockImplementation(() => {})
  // Only a browser's network stack can construct this filtered response type.
  const redirect = Object.defineProperty(Response.error(), "type", { value: "opaqueredirect" })
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(redirect)
  const input = new Request(`${location.origin}/api/info`, { headers: { "X-Test": "preserved" } })

  expect(await createWebFetch()(input, { credentials: "include" })).toBe(redirect)
  expect(fetcher).toHaveBeenCalledWith(input, { credentials: "include", redirect: "manual" })
  expect(navigate).toHaveBeenCalledTimes(1)
})

test("other origins and non-API requests retain their redirect behavior", async () => {
  location.href = "https://opencode.example/"
  const navigate = spyOn(location, "replace").mockImplementation(() => {})
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }))
  const request = createWebFetch()

  for (const url of ["https://other.example/api/info", "/apiary", "/assets/icon.svg"]) {
    await request(url, { redirect: "follow" })
    expect(fetcher).toHaveBeenLastCalledWith(url, { redirect: "follow" })
  }
  expect(navigate).not.toHaveBeenCalled()
})

test("only a successful health check after returning rearms recovery", async () => {
  location.href = "https://opencode.example/tools/opencode/"
  sessionStorage.setItem("opencode.auth-refresh", "pending")
  const navigate = spyOn(location, "replace").mockImplementation(() => {})
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }))
  const request = createWebFetch()

  await request("/tools/opencode/api/project")
  expect(sessionStorage.getItem("opencode.auth-refresh")).toBe("pending")
  await request("/tools/opencode/api/info")
  expect(sessionStorage.getItem("opencode.auth-refresh")).toBeNull()

  fetcher.mockResolvedValue(new Response(null, { status: 401 }))
  await request("/tools/opencode/api/info")
  expect(navigate).toHaveBeenCalledTimes(1)

  fetcher.mockResolvedValue(new Response(null, { status: 200 }))
  await request("/tools/opencode/api/info")
  expect(sessionStorage.getItem("opencode.auth-refresh")).toBe("pending")
})
