import { describe, expect, test } from "bun:test"
import { pairingQRLink, pairPageLink, pairPagePayload, reachableURLs } from "./pairing-link.js"

describe("pair page link", () => {
  const payload = { code: "abc_DEF-123", urls: ["http://192.168.1.2:49374", "https://r1.example.opentunnel.xyz"] }

  test("carries the code and addresses as base64url JSON in the fragment", () => {
    const link = pairPageLink(payload)
    const fragment = new URL(link).hash.slice(1)

    expect(link.startsWith("https://opencode.ai/pair#")).toBe(true)
    expect(fragment).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.parse(Buffer.from(fragment, "base64url").toString("utf8"))).toEqual(payload)
  })

  test("round trips", () => {
    expect(JSON.parse(pairPagePayload(` ${pairPageLink(payload)} `) ?? "")).toEqual(payload)
  })

  test("reads padded fragments and a trailing slash", () => {
    const fragment = Buffer.from(JSON.stringify(payload)).toString("base64").replaceAll("+", "-").replaceAll("/", "_")

    expect(pairPagePayload(`https://opencode.ai/pair/#${fragment}`)).toBe(JSON.stringify(payload))
  })

  test("keeps only addresses another device can reach", () => {
    expect(
      reachableURLs([
        "http://127.0.0.1:4096",
        "http://localhost:4096",
        "http://box.localhost:4096",
        "http://[::1]:4096",
        "http://192.168.1.2:4096",
        "http://100.64.0.3:4096",
        "https://r1.example.opentunnel.xyz",
        "not a url",
      ]),
    ).toEqual(["http://192.168.1.2:4096", "http://100.64.0.3:4096", "https://r1.example.opentunnel.xyz"])
  })

  test("a QR link leaves out container bridges and keeps what fits a scannable code, in the original order", () => {
    const bridges = Array.from({ length: 84 }, (_, i) => `http://172.${17 + (i % 15)}.${i}.1:4096`)
    const urls = [
      "http://127.0.0.1:4096",
      ...bridges.slice(0, 40),
      "http://192.168.1.2:4096",
      "http://100.64.0.3:4096",
      ...bridges.slice(40),
      "https://r1.example.opentunnel.xyz",
    ]
    const link = pairingQRLink("abc_DEF-123_4567890123", urls) ?? ""
    const payload = JSON.parse(pairPagePayload(link) ?? "")

    expect(link.length).toBeLessThanOrEqual(321)
    expect(payload.urls).toEqual([
      "http://192.168.1.2:4096",
      "http://100.64.0.3:4096",
      "https://r1.example.opentunnel.xyz",
    ])
    const only = JSON.parse(pairPagePayload(pairingQRLink("abc_DEF-123_4567890123", bridges) ?? "") ?? "")
    expect(only.urls.length).toBeGreaterThan(0)
    expect(only.urls).toEqual(bridges.slice(0, only.urls.length))
    expect(pairingQRLink("abc_DEF-123_4567890123", bridges)?.length).toBeLessThanOrEqual(321)
    expect(pairingQRLink("abc", ["http://192.168.1.2:4096"])).toBe(
      pairPageLink({ code: "abc", urls: ["http://192.168.1.2:4096"] }),
    )
  })

  test("a QR link is left out when no reachable address fits", () => {
    expect(pairingQRLink("abc", ["http://127.0.0.1:4096"])).toBeUndefined()
    expect(pairingQRLink("abc", [`http://${"a".repeat(400)}.example:4096`])).toBeUndefined()
  })

  test("ignores other links", () => {
    const fragment = new URL(pairPageLink(payload)).hash

    expect(pairPagePayload(`http://opencode.ai/pair${fragment}`)).toBeUndefined()
    expect(pairPagePayload(`https://example.com/pair${fragment}`)).toBeUndefined()
    expect(pairPagePayload(`https://opencode.ai/pairing${fragment}`)).toBeUndefined()
    expect(pairPagePayload(`https://opencode.ai/pair?x=1${fragment}`)).toBeUndefined()
    expect(pairPagePayload("https://opencode.ai/pair")).toBeUndefined()
    expect(pairPagePayload("https://opencode.ai/pair#not base64!")).toBeUndefined()
    expect(pairPagePayload("http://192.168.1.2:49374/auth/connect/abc")).toBeUndefined()
    expect(pairPagePayload("not a url")).toBeUndefined()
  })
})
