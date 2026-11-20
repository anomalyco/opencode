import { describe, expect, test } from "bun:test"
import { interpolate, rawRequest, resolveOperation } from "./api"

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

  test("interpolates query parameters into a raw method+path URL", () => {
    expect(interpolate("/api/location", { "location[directory]": "C:\\Users\\me\\Desktop" })).toEqual(
      "/api/location?location%5Bdirectory%5D=C%3A%5CUsers%5Cme%5CDesktop",
    )
  })

  test("fills path placeholders in a raw method+path URL", () => {
    expect(interpolate("/api/session/{sessionID}", { sessionID: "ses_x" })).toEqual("/api/session/ses_x")
  })

  test("rejects a missing path parameter in a raw method+path URL", () => {
    expect(() => interpolate("/api/session/{sessionID}", {})).toThrow("Missing path parameter: sessionID")
  })

  test("lets an explicit --param override an existing query value", () => {
    expect(interpolate("/api/location?location[directory]=old", { "location[directory]": "new" })).toEqual(
      "/api/location?location%5Bdirectory%5D=new",
    )
  })

  test("keeps existing query values not overridden by --param", () => {
    expect(interpolate("/api/location?existing=keep", { "location[directory]": "new" })).toEqual(
      "/api/location?existing=keep&location%5Bdirectory%5D=new",
    )
  })

  test("returns a raw path unchanged when there are no params", () => {
    expect(interpolate("/api/location", {})).toEqual("/api/location")
  })
})
