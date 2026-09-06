import { describe, expect, test } from "bun:test"
import { deepLinksFromArgv } from "./deep-links"

describe("deep links from argv", () => {
  test("finds a cold-start protocol URL", () => {
    expect(deepLinksFromArgv(["opencode", "--flag", "opencode://session/123"])).toEqual(["opencode://session/123"])
  })

  test("keeps every protocol URL and ignores other arguments", () => {
    expect(
      deepLinksFromArgv(["opencode", "opencode://project/one", "https://opencode.ai", "opencode://project/two"]),
    ).toEqual(["opencode://project/one", "opencode://project/two"])
  })
})
