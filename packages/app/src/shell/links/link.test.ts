import { describe, expect, test } from "bun:test"
import { parseSessionLink } from "./link"

const session = "ses_efcd8972fffeT5zZbj9YtIl3LU"

describe("parseSessionLink", () => {
  test("reads a session and its server hint", () => {
    expect(parseSessionLink(`opencode://session/${session}`)).toEqual({ sessionID: session })
    expect(parseSessionLink(`opencode://session/${session}?server=https://devbox.example.com:4096/`)).toEqual({
      sessionID: session,
      server: "https://devbox.example.com:4096",
    })
    expect(parseSessionLink(`opencode://session/${session}?server=sidecar`)).toEqual({
      sessionID: session,
      server: "sidecar",
    })
  })

  test("rejects other links and malicious input", () => {
    expect(parseSessionLink("opencode://console/authorized?window=a")).toBeUndefined()
    expect(parseSessionLink(`https://session/${session}`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}/x`)).toBeUndefined()
    expect(parseSessionLink("opencode://session/ses_..%2F..%2Fetc")).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}?prompt=hi`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}?server=a&server=b`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}?server=javascript:alert(1)`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}?server=https://user:pw@host`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}?server=https://host/path`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}#x`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}\n`)).toBeUndefined()
  })

  test("rejects oversized links", () => {
    expect(parseSessionLink(`opencode://session/${session}?server=${"a".repeat(2100)}`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/${session}?server=${"a".repeat(257)}`)).toBeUndefined()
    expect(parseSessionLink(`opencode://session/ses_${"a".repeat(65)}`)).toBeUndefined()
  })
})
