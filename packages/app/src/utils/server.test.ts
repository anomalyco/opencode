// FORK: sdk-falsy-empty-body-fix 单测 [feat: sdk-falsy-empty-body-fix] 2026-05-21
//
// 测试 wrapFetchWithFalsyGuard 两层兜底:
//   layer 1(2026-05-12):fetch.throw falsy → 转有效 Error("fetch returned empty rejection")
//   layer 2(2026-05-21):fetch.return 4xx/5xx + empty body → 转有效 Error("Server returned X with empty body")
//
// 防止 SDK packages/sdk/js/src/v2/gen/client/client.gen.ts:102/220 的
// `finalError || ({} as unknown)` fallback 触发,抛 `{}` 让 SolidJS ErrorBoundary
// 显示"出了点问题 / 原因: {}"空错误页。

import { describe, expect, test } from "bun:test"
import { wrapFetchWithFalsyGuard } from "./server"

describe("wrapFetchWithFalsyGuard - layer 1: falsy reject guard (2026-05-12)", () => {
  test("fetch reject 空对象 {} 转有效 Error", async () => {
    const fakeFetch = (async () => {
      throw {}
    }) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    await expect(wrapped("http://test/foo")).rejects.toThrow(/empty rejection.*http:\/\/test\/foo/)
  })

  test("fetch reject undefined 转有效 Error", async () => {
    const fakeFetch = (async () => {
      throw undefined
    }) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    await expect(wrapped("http://test/foo")).rejects.toThrow(/empty rejection/)
  })

  test("fetch reject null 转有效 Error", async () => {
    const fakeFetch = (async () => {
      throw null
    }) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    await expect(wrapped("http://test/foo")).rejects.toThrow(/empty rejection/)
  })

  test("fetch reject 空字符串 \"\" 转有效 Error", async () => {
    const fakeFetch = (async () => {
      throw ""
    }) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    await expect(wrapped("http://test/foo")).rejects.toThrow(/empty rejection/)
  })

  test("fetch reject 有效 Error 透传不改", async () => {
    const orig = new Error("original network error")
    const fakeFetch = (async () => {
      throw orig
    }) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    await expect(wrapped("http://test/foo")).rejects.toBe(orig)
  })
})

describe("wrapFetchWithFalsyGuard - layer 2: empty body 4xx/5xx guard (2026-05-21)", () => {
  test("404 + empty body → 转有效 Error,不让 SDK 抛 {}", async () => {
    const fakeFetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    await expect(wrapped("http://test/session/stale")).rejects.toThrow(
      /Server returned 404 with empty body.*http:\/\/test\/session\/stale/,
    )
  })

  test("500 + empty body → 转有效 Error", async () => {
    const fakeFetch = (async () => new Response("", { status: 500 })) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    await expect(wrapped("http://test/foo")).rejects.toThrow(/Server returned 500 with empty body/)
  })

  test("403 + empty body → 转有效 Error", async () => {
    const fakeFetch = (async () => new Response("", { status: 403 })) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    await expect(wrapped("http://test/foo")).rejects.toThrow(/Server returned 403 with empty body/)
  })

  test("404 + body 不空 → 透传给 SDK 处理,wrappedFetch 不截断", async () => {
    const fakeFetch = (async () =>
      new Response('{"error":"not found"}', { status: 404 })) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    const res = await wrapped("http://test/foo")
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('{"error":"not found"}')
  })

  test("200 success 透传不影响", async () => {
    const fakeFetch = (async () =>
      new Response('{"data":"ok"}', { status: 200 })) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    const res = await wrapped("http://test/foo")
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"data":"ok"}')
  })

  test("204 No Content(empty body 但 .ok=true)不应触发兜底", async () => {
    const fakeFetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    const res = await wrapped("http://test/foo")
    expect(res.status).toBe(204)
  })
})

describe("wrapFetchWithFalsyGuard - input 类型兼容性", () => {
  test("接受 Request 对象", async () => {
    const fakeFetch = (async () =>
      new Response("", { status: 404 })) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    const req = new Request("http://test/req")
    await expect(wrapped(req)).rejects.toThrow(/http:\/\/test\/req/)
  })

  test("接受 URL 对象", async () => {
    const fakeFetch = (async () =>
      new Response("", { status: 404 })) as unknown as typeof fetch
    const wrapped = wrapFetchWithFalsyGuard(fakeFetch)
    const url = new URL("http://test/url")
    await expect(wrapped(url)).rejects.toThrow(/http:\/\/test\/url/)
  })
})
