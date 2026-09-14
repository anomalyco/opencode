import { describe, expect, test } from "bun:test"
import { authorization, ready } from "./sidecar-credentials"

const sidecar = { url: "http://127.0.0.1:4096", password: "secret" }
const expected = `Basic ${Buffer.from("opencode:secret").toString("base64")}`

describe("sidecar authorization", () => {
  test("adds the Basic credential only for the sidecar origin", () => {
    expect(authorization(sidecar, "http://127.0.0.1:4096/api/session?limit=1")).toBe(expected)
    expect(authorization(sidecar, "http://127.0.0.1:4097/api/session")).toBeUndefined()
    expect(authorization(sidecar, "http://localhost:4096/api/session")).toBeUndefined()
    expect(authorization(sidecar, "https://127.0.0.1:4096/api/session")).toBeUndefined()
  })

  test("hands the renderer the origin only", () => {
    expect(ready(sidecar)).toEqual({ url: sidecar.url })
  })

  test("adds nothing before the sidecar is known or when it has no password", () => {
    expect(authorization(undefined, "http://127.0.0.1:4096/api/session")).toBeUndefined()
    expect(authorization({ url: sidecar.url, password: null }, "http://127.0.0.1:4096/api/session")).toBeUndefined()
    expect(authorization(sidecar, "not a url")).toBeUndefined()
  })
})
