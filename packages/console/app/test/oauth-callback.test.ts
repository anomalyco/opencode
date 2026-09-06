import { describe, expect, test } from "bun:test"
import { resolveOAuthCallback } from "../src/lib/oauth-callback"
import { dict as en } from "../src/i18n/en"

const params = (query: string) => new URLSearchParams(query)

describe("resolveOAuthCallback", () => {
  test("returns success when a code is present", () => {
    expect(resolveOAuthCallback(params("code=abc123&state=x"), en)).toEqual({ type: "success" })
  })

  test("treats access_denied as a user cancellation", () => {
    const outcome = resolveOAuthCallback(params("error=access_denied&error_description=The user denied"), en)
    expect(outcome).toEqual({ type: "denied" })
  })

  test("returns an error message when the code is missing", () => {
    const outcome = resolveOAuthCallback(params("state=x"), en)
    expect(outcome).toEqual({ type: "error", message: en["auth.callback.error.codeMissing"] })
  })

  test("surfaces the error description for other OAuth errors", () => {
    const outcome = resolveOAuthCallback(
      params("error=invalid_request&error_description=Missing scope"),
      en,
    )
    expect(outcome).toEqual({ type: "error", message: `${en["auth.callback.error.oauth"]} Missing scope` })
  })

  test("falls back to the error code when no description is provided", () => {
    const outcome = resolveOAuthCallback(params("error=server_error"), en)
    expect(outcome).toEqual({ type: "error", message: `${en["auth.callback.error.oauth"]} server_error` })
  })

  test("does not include raw query parameters in the error message", () => {
    const outcome = resolveOAuthCallback(params("error=server_error&code=secret"), en)
    expect(outcome.type).toBe("error")
    if (outcome.type === "error") expect(outcome.message).not.toContain("secret")
  })
})
