import { describe, expect, test } from "bun:test"
import { createUnauthorizedFallbackFetch } from "./client"

describe("createUnauthorizedFallbackFetch", () => {
  for (const status of [401, 403]) {
    test(`falls back after live ${status} responses without losing the request body`, async () => {
      let liveCalls = 0
      const fallbackRequests: Request[] = []

      const fetcher = createUnauthorizedFallbackFetch({
        liveFetch: async (request) => {
          liveCalls++
          expect(await request.text()).toBe("payload")
          return new Response("unauthorized", { status })
        },
        fallbackFetch: async (request) => {
          fallbackRequests.push(request.clone())
          return new Response(
            JSON.stringify({
              body: await request.text(),
              header: request.headers.get("x-plugin"),
            }),
            { headers: { "content-type": "application/json" } },
          )
        },
      })

      const first = await fetcher(
        new Request("http://live.test/api/config", {
          method: "POST",
          headers: { "x-plugin": "server" },
          body: "payload",
        }),
      )
      await expect(first.json()).resolves.toEqual({ body: "payload", header: "server" })

      const second = await fetcher(new Request("http://live.test/api/config"))

      expect(second.status).toBe(200)
      expect(liveCalls).toBe(1)
      expect(fallbackRequests).toHaveLength(2)
    })
  }

  test("keeps using live fetch for non-auth failures", async () => {
    let liveCalls = 0
    let fallbackCalls = 0
    const fetcher = createUnauthorizedFallbackFetch({
      liveFetch: async () => {
        liveCalls++
        return new Response("server error", { status: 500 })
      },
      fallbackFetch: async () => {
        fallbackCalls++
        return new Response("fallback")
      },
    })

    expect((await fetcher(new Request("http://live.test/api/config"))).status).toBe(500)
    expect((await fetcher(new Request("http://live.test/api/config"))).status).toBe(500)
    expect(liveCalls).toBe(2)
    expect(fallbackCalls).toBe(0)
  })
})
