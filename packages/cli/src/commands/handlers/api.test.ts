import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { rawRequest, resolveOperation, resolveRequest } from "./api"

describe("api request resolution", () => {
  test("resolves an operation ID with path and query parameters", () => {
    expect(
      resolveOperation(
        {
          paths: {
            "/api/session/{sessionID}": {
              get: { operationId: "session.get" },
            },
          },
        },
        "session.get",
        { sessionID: "ses/a", workspace: "work" },
      ),
    ).toEqual({ method: "GET", path: "/api/session/ses%2Fa?workspace=work" })
  })

  test("rejects a missing path parameter", () => {
    expect(() =>
      resolveOperation(
        { paths: { "/api/session/{sessionID}": { get: { operationId: "session.get" } } } },
        "session.get",
        {},
      ),
    ).toThrow("Missing path parameter: sessionID")
  })

  test("resolves curl-like method and path input", () => {
    expect(rawRequest(["post", "/api/foo"])).toEqual({ method: "POST", path: "/api/foo" })
    expect(rawRequest(["session.list"])).toBeUndefined()
  })

  test("applies query-only params to raw method and path input", () => {
    expect(rawRequest(["get", "/api/location"], { "location[directory]": "/tmp/project" })).toEqual({
      method: "GET",
      path: "/api/location?location%5Bdirectory%5D=%2Ftmp%2Fproject",
    })
  })

  test("interpolates path placeholders and appends extra query params on raw requests", () => {
    expect(
      rawRequest(["GET", "/api/session/{sessionID}"], {
        sessionID: "ses/a",
        workspace: "work",
      }),
    ).toEqual({
      method: "GET",
      path: "/api/session/ses%2Fa?workspace=work",
    })
  })

  test("rejects missing and prototype-inherited path placeholders on raw requests", () => {
    expect(() => rawRequest(["GET", "/api/session/{sessionID}"], {})).toThrow("Missing path parameter: sessionID")
    expect(() => rawRequest(["GET", "/api/session/{toString}"], {})).toThrow("Missing path parameter: toString")
  })

  test("merges params into an existing query string and overrides duplicated keys", () => {
    expect(rawRequest(["GET", "/api/items?a=1&b=old"], { b: "new", c: "3" })).toEqual({
      method: "GET",
      path: "/api/items?a=1&b=new&c=3",
    })
  })

  test("sends an existing query string as written when no params are added", () => {
    expect(rawRequest(["GET", '/api/items?q=a%20b&flag&filter={"a":1}'])).toEqual({
      method: "GET",
      path: '/api/items?q=a%20b&flag&filter={"a":1}',
    })
  })

  test("does not treat braces in an existing query string as path placeholders", () => {
    expect(rawRequest(["GET", '/api/items?filter={"a":1}'], { limit: "10" })).toEqual({
      method: "GET",
      path: "/api/items?filter=%7B%22a%22%3A1%7D&limit=10",
    })
  })

  test("preserves fragments while interpolating path and query params", () => {
    expect(
      rawRequest(["GET", "/api/session/{sessionID}?a=1#section?keep={raw}"], {
        sessionID: "ses_1",
        b: "2",
      }),
    ).toEqual({
      method: "GET",
      path: "/api/session/ses_1?a=1&b=2#section?keep={raw}",
    })
  })

  test("resolveRequest interpolates raw requests and fails cleanly in Effect on missing placeholders", async () => {
    const endpoint = { url: "http://127.0.0.1:4096" }
    const resolved = await Effect.runPromise(
      resolveRequest(endpoint, ["GET", "/api/session/{sessionID}"], { sessionID: "ses_1", detail: "full" }),
    )
    expect(resolved).toEqual({
      method: "GET",
      path: "/api/session/ses_1?detail=full",
    })

    await expect(Effect.runPromise(resolveRequest(endpoint, ["GET", "/api/session/{sessionID}"], {}))).rejects.toThrow(
      "Missing path parameter: sessionID",
    )
  })
})
