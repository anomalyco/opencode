/**
 * ANR Credential Refresh Tests
 *
 * Validates:
 * - Refresh initialization
 * - Expired token detection
 * - Refresh execution
 * - Listener notification on refresh
 * - Error recovery behavior
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"

// Import from opencode package's auth module
const refreshModule = await import("../../opencode/src/auth/anr-refresh")

function mockRefreshFn(result?: Partial<Awaited<ReturnType<Parameters<typeof refreshModule.init>[0]["refresh"]>>>) {
  return async () => ({
    accessKeyId: "AKIATEST",
    secretAccessKey: "secret-test",
    sessionToken: "token-test",
    idToken: "id-token-test",
    expiration: new Date(Date.now() + 3600_000), // 1 hour from now
    ...result,
  })
}

describe("ANR Credential Refresh", () => {
  afterEach(() => {
    // Module doesn't export stop(), but we can reinit to clear state
  })

  test("init does not throw", () => {
    expect(() => refreshModule.init({
      stsExpiration: Date.now() + 3600_000,
      refresh: mockRefreshFn(),
    })).not.toThrow()
  })

  test("expired returns false when credentials are fresh", () => {
    refreshModule.init({
      stsExpiration: Date.now() + 3600_000, // 1 hour from now
      refresh: mockRefreshFn(),
    })
    expect(refreshModule.expired()).toBe(false)
  })

  test("expired returns true when credentials are about to expire", () => {
    refreshModule.init({
      stsExpiration: Date.now() + 2 * 60 * 1000, // 2 minutes from now (within 5-min buffer)
      refresh: mockRefreshFn(),
    })
    expect(refreshModule.expired()).toBe(true)
  })

  test("expired returns true when credentials are already expired", () => {
    refreshModule.init({
      stsExpiration: Date.now() - 1000, // Already expired
      refresh: mockRefreshFn(),
    })
    expect(refreshModule.expired()).toBe(true)
  })

  test("onRefresh registers listener", () => {
    refreshModule.init({
      stsExpiration: Date.now() + 3600_000,
      refresh: mockRefreshFn(),
    })
    let notified = false
    refreshModule.onRefresh(() => { notified = true })
    expect(notified).toBe(false)
  })

  test("manual refresh triggers the refresh function and returns true", async () => {
    let called = false
    refreshModule.init({
      stsExpiration: Date.now() + 3600_000,
      refresh: async () => {
        called = true
        return {
          accessKeyId: "AKIANEW",
          secretAccessKey: "new-secret",
          sessionToken: "new-token",
          expiration: new Date(Date.now() + 3600_000),
        }
      },
    })
    const result = await refreshModule.refresh()
    expect(called).toBe(true)
    expect(result).toBe(true)
  })

  test("manual refresh notifies listeners with new credentials", async () => {
    let receivedCreds: unknown = null
    refreshModule.init({
      stsExpiration: Date.now() + 3600_000,
      refresh: mockRefreshFn({ accessKeyId: "AKIANOTIFY" }),
    })
    refreshModule.onRefresh((creds) => { receivedCreds = creds })
    await refreshModule.refresh()
    expect(receivedCreds).not.toBeNull()
    expect((receivedCreds as { accessKeyId: string }).accessKeyId).toBe("AKIANOTIFY")
  })

  test("refresh function failure returns false (does not crash)", async () => {
    refreshModule.init({
      stsExpiration: Date.now() + 3600_000,
      refresh: async () => { throw new Error("token expired") },
    })
    const result = await refreshModule.refresh()
    expect(result).toBe(false)
  })

  test("refresh updates process.env credentials", async () => {
    refreshModule.init({
      stsExpiration: Date.now() + 3600_000,
      refresh: mockRefreshFn({ accessKeyId: "AKIAENVTEST", secretAccessKey: "envSecret", sessionToken: "envToken" }),
    })
    await refreshModule.refresh()
    expect(process.env.AWS_ACCESS_KEY_ID).toBe("AKIAENVTEST")
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBe("envSecret")
    expect(process.env.AWS_SESSION_TOKEN).toBe("envToken")
  })
})
