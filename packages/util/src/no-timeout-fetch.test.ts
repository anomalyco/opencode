import { afterAll, expect, test } from "bun:test"
import { noTimeoutFetch } from "./no-timeout-fetch.js"

const pending = Promise.withResolvers<void>()
const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    if (new URL(request.url).pathname === "/hang") {
      pending.resolve()
      return new Promise<Response>(() => {})
    }
    return Response.json({ method: request.method, header: request.headers.get("x-test"), body: await request.text() })
  },
})

afterAll(() => server.stop(true))

test("preserves the request init", async () => {
  const response = await noTimeoutFetch(new URL("/echo", server.url), {
    method: "POST",
    headers: { "x-test": "value" },
    body: "payload",
  })
  expect(await response.json()).toEqual({ method: "POST", header: "value", body: "payload" })
})

test("still honours an abort signal", async () => {
  const controller = new AbortController()
  const request = noTimeoutFetch(new URL("/hang", server.url), { signal: controller.signal })
  await pending.promise
  controller.abort()
  await expect(request).rejects.toMatchObject({ name: "AbortError" })
})
