import { describe, expect, test } from "bun:test"
import { rawRequest, resolveOperation } from "./api"

describe("api request resolution", () => {
  test("resolves an operation ID with path and query parameters", () => {
    expect(
      resolveOperation(
        {
          paths: {
            "/api/session/{sessionID}": {
              get: { operationId: "v2.session.get" },
            },
          },
        },
        "v2.session.get",
        { sessionID: "ses/a", workspace: "work" },
      ),
    ).toEqual({ method: "GET", path: "/api/session/ses%2Fa?workspace=work" })
  })

  test("rejects a missing path parameter", () => {
    expect(() =>
      resolveOperation(
        { paths: { "/api/session/{sessionID}": { get: { operationId: "v2.session.get" } } } },
        "v2.session.get",
        {},
      ),
    ).toThrow("Missing path parameter: sessionID")
  })

  test("resolves curl-like method and path input", () => {
    expect(rawRequest(["post", "/api/foo"])).toEqual({ method: "POST", path: "/api/foo" })
    expect(rawRequest(["v2.session.list"])).toBeUndefined()
  })
})
