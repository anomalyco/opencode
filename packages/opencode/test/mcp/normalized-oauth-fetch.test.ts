import { test, expect, spyOn } from "bun:test"
import { normalizedOAuthFetch } from "../../src/mcp/oauth-provider"

function setupFetch(body: unknown, status: number, contentType = "application/json") {
    const spy = spyOn(globalThis, "fetch").mockImplementation(
      (async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(
          typeof body === "string" ? body : JSON.stringify(body),
          {
            status,
            headers: { "Content-Type": contentType },
          },
        )
      }) as typeof fetch
    )
  
    return spy
  }

test("passes through successful responses unchanged", async () => {
  const spy = setupFetch({ access_token: "abc123" }, 200)
  const response = await normalizedOAuthFetch("https://example.com/token")
  const body = await response.json()
  expect(response.status).toBe(200)
  expect(body.access_token).toBe("abc123")
  spy.mockRestore()
})

test("passes through standard RFC 6749 error responses unchanged", async () => {
  const spy = setupFetch({ error: "invalid_grant", error_description: "Invalid authorization code" }, 400)
  const response = await normalizedOAuthFetch("https://example.com/token")
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(body.error).toBe("invalid_grant")
  expect(body.error_description).toBe("Invalid authorization code")
  spy.mockRestore()
})

test("normalizes Datadog-style {errors: [...]} to standard {error, error_description}", async () => {
  const spy = setupFetch({ errors: ["invalid_grant - Invalid authorization code or code verifier."] }, 400)
  const response = await normalizedOAuthFetch("https://example.com/token")
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(body.error).toBe("invalid_grant")
  expect(body.error_description).toBe("invalid_grant - Invalid authorization code or code verifier.")
  expect(body.errors).toBeUndefined()
  spy.mockRestore()
})

test("normalizes multiple errors in array to comma-separated error_description", async () => {
  const spy = setupFetch({ errors: ["invalid_grant - error one", "invalid_scope - error two"] }, 400)
  const response = await normalizedOAuthFetch("https://example.com/token")
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(body.error).toBe("invalid_grant")
  expect(body.error_description).toBe("invalid_grant - error one, invalid_scope - error two")
  expect(body.errors).toBeUndefined()
  spy.mockRestore()
})

test("passes through non-JSON error responses unchanged", async () => {
  const spy = setupFetch("Internal Server Error", 500, "text/plain")
  const response = await normalizedOAuthFetch("https://example.com/token")
  const body = await response.text()
  expect(response.status).toBe(500)
  expect(body).toBe("Internal Server Error")
  spy.mockRestore()
})

test("does not modify response when errors field is not an array", async () => {
  const spy = setupFetch({ errors: "some string error" }, 400)
  const response = await normalizedOAuthFetch("https://example.com/token")
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(body.errors).toBe("some string error")
  expect(body.error).toBeUndefined()
  spy.mockRestore()
})

test("does not modify response when both error and errors fields exist", async () => {
  const spy = setupFetch({ error: "invalid_grant", errors: ["some extra field"] }, 400)
  const response = await normalizedOAuthFetch("https://example.com/token")
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(body.error).toBe("invalid_grant")
  expect(body.errors).toEqual(["some extra field"])
  spy.mockRestore()
})