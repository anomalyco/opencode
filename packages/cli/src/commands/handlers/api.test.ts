import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Endpoint } from "@opencode/client/effect/service"
import { rawRequest, resolveOperation, resolveRequest } from "./api"

const endpoint: Endpoint = { url: "http://localhost:0" }

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

  test("applies parameters to a raw method and path", () => {
    expect(Effect.runSync(resolveRequest(endpoint, ["get", "/api/fs/list"], { path: "/tmp/dir" }))).toEqual({
      method: "GET",
      path: "/api/fs/list?path=%2Ftmp%2Fdir",
    })
  })

  test("binds raw path placeholders and lets parameters override a duplicated query value", () => {
    expect(
      Effect.runSync(
        resolveRequest(endpoint, ["get", "/api/session/{sessionID}?limit=1"], {
          sessionID: "ses/a",
          limit: "2",
          page: "3",
        }),
      ),
    ).toEqual({ method: "GET", path: "/api/session/ses%2Fa?limit=2&page=3" })
  })

  test("reports a missing raw path parameter", () => {
    expect(() => Effect.runSync(resolveRequest(endpoint, ["get", "/api/session/{sessionID}"], {}))).toThrow(
      "Missing path parameter: sessionID",
    )
  })
})
