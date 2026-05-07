import { describe, expect, test } from "bun:test"
import { withRetry } from "../../src/utils/retry.js"

describe("withRetry", () => {
  test("首次成功直接返回", async () => {
    const result = await withRetry(() => Promise.resolve("ok"))
    expect(result).toBe("ok")
  })

  test("重试后成功", async () => {
    let attempts = 0
    const result = await withRetry(
      () => {
        attempts++
        if (attempts < 3) {
          const err: any = new Error("transient failure")
          err.status = 500
          throw err
        }
        return Promise.resolve("success")
      },
      { maxRetries: 3, baseDelay: 10 },
    )
    expect(result).toBe("success")
    expect(attempts).toBe(3)
  })

  test("超过最大重试次数抛出", async () => {
    const err: any = new Error("persistent failure")
    err.status = 500

    await expect(
      withRetry(() => { throw err }, { maxRetries: 2, baseDelay: 10 }),
    ).rejects.toThrow("persistent failure")
  })

  test("不可重试的错误立即抛出", async () => {
    const err: any = new Error("bad request")
    err.status = 400

    await expect(
      withRetry(() => { throw err }, { maxRetries: 3, baseDelay: 10 }),
    ).rejects.toThrow("bad request")
  })

  test("自定义 retryable 判断", async () => {
    let attempts = 0
    await withRetry(
      () => {
        attempts++
        if (attempts < 2) throw new Error("custom retry")
        return Promise.resolve("done")
      },
      {
        maxRetries: 2,
        baseDelay: 10,
        retryable: (err) => err.message === "custom retry",
      },
    )
    expect(attempts).toBe(2)
  })

  test("网络错误可重试", async () => {
    let attempts = 0
    const result = await withRetry(
      () => {
        attempts++
        if (attempts === 1) throw new Error("ECONNREFUSED")
        return Promise.resolve("recovered")
      },
      { maxRetries: 2, baseDelay: 10 },
    )
    expect(result).toBe("recovered")
    expect(attempts).toBe(2)
  })
})
