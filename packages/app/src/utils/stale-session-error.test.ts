// FORK: isStaleSessionError 单测 [feat: frontend-stale-session-fallback] 2026-05-21

import { describe, expect, test } from "bun:test"
import { isStaleSessionError } from "./stale-session-error"

describe("isStaleSessionError", () => {
  test("401 + empty body → true(sidecar 不认 session id,需 fallback)", () => {
    const e = new Error("Server returned 401 with empty body: http://127.0.0.1:1234/session/ses_xxx/message")
    expect(isStaleSessionError(e)).toBe(true)
  })

  test("404 + empty body → true(session 已删除 / archived)", () => {
    const e = new Error("Server returned 404 with empty body: http://127.0.0.1:1234/session/ses_xxx")
    expect(isStaleSessionError(e)).toBe(true)
  })

  test("500 + empty body → false(5xx 服务故障,user retry 可能恢复,不应清 session id)", () => {
    const e = new Error("Server returned 500 with empty body: http://127.0.0.1:1234/session/ses_xxx")
    expect(isStaleSessionError(e)).toBe(false)
  })

  test("403 + empty body → false(暂不视为 stale,需求出现再扩 regex)", () => {
    const e = new Error("Server returned 403 with empty body: http://127.0.0.1:1234/session/ses_xxx")
    expect(isStaleSessionError(e)).toBe(false)
  })

  test("fetch network error → false(网络断,user retry 可恢复)", () => {
    const e = new TypeError("Failed to fetch")
    expect(isStaleSessionError(e)).toBe(false)
  })

  test("AbortError → false", () => {
    const e = new Error("aborted")
    e.name = "AbortError"
    expect(isStaleSessionError(e)).toBe(false)
  })

  test("sdk-falsy-error-fallback-fix layer 1 抛的 empty rejection → false(不是 stale,是 fetch 异常)", () => {
    const e = new Error("fetch returned empty rejection: http://127.0.0.1:1234/session/ses_xxx")
    expect(isStaleSessionError(e)).toBe(false)
  })

  test("Server returned 401 但 body 非空(SDK 抛 textError)→ false(不在我们 wrappedFetch 抛的 path)", () => {
    // SDK 自己 throwOnError 时抛 JSON body / text body,Message 不含 "Server returned X with empty body"
    const e = new Error('{"error":"unauthorized"}')
    expect(isStaleSessionError(e)).toBe(false)
  })

  test("non-Error → false", () => {
    expect(isStaleSessionError("string error")).toBe(false)
    expect(isStaleSessionError({})).toBe(false)
    expect(isStaleSessionError(null)).toBe(false)
    expect(isStaleSessionError(undefined)).toBe(false)
    expect(isStaleSessionError(123)).toBe(false)
  })

  test("Error subclass 也支持(如 TypeError 但 message 是 stale 格式 — 罕见但理论可能)", () => {
    const e = new TypeError("Server returned 404 with empty body: http://test")
    expect(isStaleSessionError(e)).toBe(true)
  })
})
