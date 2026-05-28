import { describe, expect, test } from "bun:test"
import { apiUrl } from "./api-url"

describe("apiUrl", () => {
  test("preserves reverse proxy base path", () => {
    expect(String(apiUrl("https://opencode.dev.jitda.io/user/heu56ribam8opgty", "/doc/doc_1/connect"))).toBe(
      "https://opencode.dev.jitda.io/user/heu56ribam8opgty/doc/doc_1/connect",
    )
  })
})
