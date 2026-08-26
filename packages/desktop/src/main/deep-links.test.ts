import { describe, expect, test } from "bun:test"
import { collectDeepLinkArgs } from "./deep-links"

describe("desktop deep links", () => {
  test("collects protocol URLs from process arguments", () => {
    expect(
      collectDeepLinkArgs([
        "OpenCode.exe",
        "--flag",
        "opencode://open-session?server=sidecar&session=ses_1",
        "https://example.com",
        "OPENCODE://open-project?directory=C%3A%5Cdemo",
      ]),
    ).toEqual(["opencode://open-session?server=sidecar&session=ses_1", "OPENCODE://open-project?directory=C%3A%5Cdemo"])
  })

  test("ignores malformed and unrelated arguments", () => {
    expect(collectDeepLinkArgs(["OpenCode.exe", "opencode://[", "not a URL", "file:///tmp/demo"])).toEqual([])
  })
})
