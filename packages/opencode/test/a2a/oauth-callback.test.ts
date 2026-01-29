import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { A2AOAuthCallback } from "../../src/a2a/oauth/callback"

describe("a2a.oauth.callback", () => {
  afterEach(async () => {
    await A2AOAuthCallback.stop()
  })

  describe("server lifecycle", () => {
    test("starts server on ensureRunning", async () => {
      expect(A2AOAuthCallback.isRunning()).toBe(false)

      await A2AOAuthCallback.ensureRunning()

      expect(A2AOAuthCallback.isRunning()).toBe(true)
    })

    test("ensureRunning is idempotent", async () => {
      await A2AOAuthCallback.ensureRunning()
      await A2AOAuthCallback.ensureRunning()

      expect(A2AOAuthCallback.isRunning()).toBe(true)
    })

    test("stop shuts down server", async () => {
      await A2AOAuthCallback.ensureRunning()
      await A2AOAuthCallback.stop()

      expect(A2AOAuthCallback.isRunning()).toBe(false)
    })
  })

  describe("getRedirectUri", () => {
    test("returns localhost URL with correct path", () => {
      const uri = A2AOAuthCallback.getRedirectUri()

      expect(uri).toContain("http://127.0.0.1:")
      expect(uri).toContain("/a2a/oauth/callback")
    })
  })

  describe("callback handling", () => {
    test("waitForCallback resolves with code when callback received", async () => {
      await A2AOAuthCallback.ensureRunning()
      const state = "test-state-123"

      const callbackPromise = A2AOAuthCallback.waitForCallback(state)

      // Simulate callback
      const uri = A2AOAuthCallback.getRedirectUri()
      const callbackUrl = `${uri}?code=auth-code-456&state=${state}`
      const response = await fetch(callbackUrl)

      expect(response.ok).toBe(true)

      const code = await callbackPromise
      expect(code).toBe("auth-code-456")
    })

    test("rejects callback with invalid state", async () => {
      await A2AOAuthCallback.ensureRunning()
      const state = "test-state-invalid"

      // Start waiting but handle rejection
      const waitPromise = A2AOAuthCallback.waitForCallback(state).catch(() => {
        // Will be rejected when we cancel
      })

      // Simulate callback with wrong state
      const uri = A2AOAuthCallback.getRedirectUri()
      const callbackUrl = `${uri}?code=auth-code-456&state=wrong-state`
      const response = await fetch(callbackUrl)

      // Should return error HTML
      expect(response.status).toBe(400)
      const html = await response.text()
      expect(html).toContain("Invalid or expired state")

      // Cancel the pending callback to avoid unhandled rejection
      A2AOAuthCallback.cancelPending(state)
      await waitPromise
    })

    test("rejects callback with missing state", async () => {
      await A2AOAuthCallback.ensureRunning()

      const uri = A2AOAuthCallback.getRedirectUri()
      const callbackUrl = `${uri}?code=auth-code-456`
      const response = await fetch(callbackUrl)

      expect(response.status).toBe(400)
      const html = await response.text()
      expect(html).toContain("Missing required state")
    })

    test("handles OAuth error response", async () => {
      await A2AOAuthCallback.ensureRunning()
      const state = "test-state-error"

      // Set up error handler before waiting
      let caughtError: Error | undefined
      const callbackPromise = A2AOAuthCallback.waitForCallback(state).catch((err) => {
        caughtError = err
      })

      // Simulate error callback
      const uri = A2AOAuthCallback.getRedirectUri()
      const callbackUrl = `${uri}?error=access_denied&error_description=User+denied+access&state=${state}`
      await fetch(callbackUrl)

      // Wait for promise to settle
      await callbackPromise

      // Verify the error message
      expect(caughtError?.message).toBe("User denied access")
    })

    test("cancelPending rejects waiting callback", async () => {
      await A2AOAuthCallback.ensureRunning()
      const state = "test-state-123"

      const callbackPromise = A2AOAuthCallback.waitForCallback(state)

      A2AOAuthCallback.cancelPending(state)

      await expect(callbackPromise).rejects.toThrow("cancelled")
    })
  })

  describe("404 handling", () => {
    test("returns 404 for non-callback paths", async () => {
      await A2AOAuthCallback.ensureRunning()
      const uri = A2AOAuthCallback.getRedirectUri()
      const baseUrl = uri.replace("/a2a/oauth/callback", "")

      const response = await fetch(`${baseUrl}/other/path`)

      expect(response.status).toBe(404)
    })
  })
})
