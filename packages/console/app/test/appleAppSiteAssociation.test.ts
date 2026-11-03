import { describe, expect, test } from "bun:test"
import { appleAppSiteAssociation } from "../src/lib/apple-app-site-association"

describe("apple app site association", () => {
  test("serves JSON that opens only /pair links in the iOS app", async () => {
    const response = appleAppSiteAssociation(new Request("https://opencode.ai/.well-known/apple-app-site-association"))

    expect(response?.status).toBe(200)
    expect(response?.headers.get("content-type")).toBe("application/json")
    expect(await response?.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["5NZ4Q7NXJ4.ai.opencode.mobilecode"],
            components: [{ "/": "/pair", comment: "pairing links, payload in the fragment" }, { "/": "/pair/*" }],
          },
        ],
      },
    })
  })

  test("answers HEAD without a body", async () => {
    const response = appleAppSiteAssociation(
      new Request("https://opencode.ai/.well-known/apple-app-site-association", { method: "HEAD" }),
    )

    expect(response?.headers.get("content-type")).toBe("application/json")
    expect(await response?.text()).toBe("")
  })

  test("ignores other paths and methods", () => {
    expect(
      [
        new Request("https://opencode.ai/.well-known/apple-app-site-association.json"),
        new Request("https://opencode.ai/pair"),
        new Request("https://opencode.ai/.well-known/apple-app-site-association", { method: "POST" }),
      ].map(appleAppSiteAssociation),
    ).toEqual([undefined, undefined, undefined])
  })
})
