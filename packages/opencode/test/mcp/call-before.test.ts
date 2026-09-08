import { describe, expect, test } from "bun:test"
import { McpCallContext, McpCallContext as Ctx, makeMcpFetch } from "../../src/mcp/index"

describe("McpCallContext", () => {
  test("getStore returns undefined outside run scope", () => {
    expect(McpCallContext.getStore()).toBeUndefined()
  })

  test("getStore returns the store inside run scope", () => {
    const captured = McpCallContext.run(
      {
        server: "s",
        tool: "t",
        sessionID: "sess",
        callID: "call",
        headers: { "X-Foo": "1" },
      },
      () => McpCallContext.getStore(),
    )
    expect(captured).toEqual({
      server: "s",
      tool: "t",
      sessionID: "sess",
      callID: "call",
      headers: { "X-Foo": "1" },
    })
  })

  test("concurrent run scopes do not leak between callbacks", async () => {
    const seen: Array<string | undefined> = []
    await Promise.all([
      McpCallContext.run({ server: "a", tool: "t", sessionID: "s", callID: "c-a", headers: {} }, async () => {
        await new Promise((r) => setTimeout(r, 5))
        seen.push(McpCallContext.getStore()?.callID)
      }),
      McpCallContext.run({ server: "b", tool: "t", sessionID: "s", callID: "c-b", headers: {} }, async () => {
        seen.push(McpCallContext.getStore()?.callID)
        await new Promise((r) => setTimeout(r, 1))
      }),
    ])
    expect(new Set(seen)).toEqual(new Set(["c-a", "c-b"]))
    expect(McpCallContext.getStore()).toBeUndefined()
  })
})

describe("makeMcpFetch", () => {
  test("delegates with unchanged init when no store is set", async () => {
    let captured: { url: string | URL; init?: RequestInit } | undefined
    const baseFetch = async (url: string | URL, init?: RequestInit) => {
      captured = { url, init }
      return new Response("ok")
    }
    const wrapped = makeMcpFetch(baseFetch)
    await wrapped("https://example.com/", { headers: { "X-Static": "yes" } })
    expect(captured?.init?.headers).toEqual({ "X-Static": "yes" })
  })

  test("merges store.headers on top of init.headers", async () => {
    let captured: RequestInit | undefined
    const baseFetch = async (_url: string | URL, init?: RequestInit) => {
      captured = init
      return new Response("ok")
    }
    const wrapped = makeMcpFetch(baseFetch)
    await Ctx.run(
      {
        server: "metrics",
        tool: "query",
        sessionID: "sess-1",
        callID: "call-1",
        headers: { "X-Session-Id": "sess-1", Authorization: "Bearer NEW" },
      },
      async () => {
        await wrapped("https://example.com/", {
          headers: { Authorization: "Bearer OLD", "X-Static": "yes" },
        })
      },
    )
    expect(captured?.headers).toEqual({
      authorization: "Bearer NEW",
      "x-static": "yes",
      "x-session-id": "sess-1",
    })
  })

  test("accepts Headers instance in init and merges correctly", async () => {
    let captured: RequestInit | undefined
    const baseFetch = async (_url: string | URL, init?: RequestInit) => {
      captured = init
      return new Response("ok")
    }
    const wrapped = makeMcpFetch(baseFetch)
    await Ctx.run(
      {
        server: "metrics",
        tool: "query",
        sessionID: "s",
        callID: "c",
        headers: { "X-A": "1" },
      },
      async () => {
        const h = new Headers({ "X-B": "2" })
        await wrapped("https://example.com/", { headers: h })
      },
    )
    expect(captured?.headers).toEqual({ "x-a": "1", "x-b": "2" })
  })

  test("lowercases store keys when merging so plugin keys override init keys regardless of case", async () => {
    let captured: RequestInit | undefined
    const baseFetch = async (_url: string | URL, init?: RequestInit) => {
      captured = init
      return new Response("ok")
    }
    const wrapped = makeMcpFetch(baseFetch)
    await Ctx.run(
      {
        server: "metrics",
        tool: "query",
        sessionID: "s",
        callID: "c",
        // Plugin uses mixed-case keys
        headers: { "X-Session-Id": "from-plugin", Authorization: "Bearer NEW" },
      },
      async () => {
        // SDK supplies the same logical header as a Headers instance (lowercase)
        const h = new Headers({ authorization: "Bearer OLD", "x-session-id": "from-sdk" })
        await wrapped("https://example.com/", { headers: h })
      },
    )
    expect(captured?.headers).toEqual({
      authorization: "Bearer NEW",
      "x-session-id": "from-plugin",
    })
  })

  test("when store.headers omits a key, init.headers's value is preserved", async () => {
    let captured: RequestInit | undefined
    const baseFetch = async (_url: string | URL, init?: RequestInit) => {
      captured = init
      return new Response("ok")
    }
    const wrapped = makeMcpFetch(baseFetch)
    await Ctx.run(
      {
        server: "metrics",
        tool: "query",
        sessionID: "s",
        callID: "c",
        // Plugin "deleted" the Authorization key by not including it in resolved headers
        headers: { "x-session-id": "s" },
      },
      async () => {
        // SDK supplied init contains a static-config Authorization header
        await wrapped("https://example.com/", { headers: { authorization: "Bearer FROM-STATIC" } })
      },
    )
    // Implementation note: makeMcpFetch only merges store keys on top of init keys.
    // It does NOT actively delete keys present in init but absent from store. That
    // deletion semantic is handled upstream in prompt.ts (the plugin can delete
    // keys from output.headers, which means they won't appear in store.headers).
    // This test exercises only the merge behavior: a key in init that is not
    // shadowed by store stays as-is.
    expect(captured?.headers).toEqual({
      authorization: "Bearer FROM-STATIC",
      "x-session-id": "s",
    })
  })
})
