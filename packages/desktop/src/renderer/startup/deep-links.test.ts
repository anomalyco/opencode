import { describe, expect, test } from "bun:test"
import { parseDeepLink } from "./deep-links"

describe("parseDeepLink", () => {
  test.each([
    ["opencode://new-session?directory=/tmp/demo", { type: "new-session", directory: "/tmp/demo", prompt: undefined }],
    [
      "opencode://new-session?directory=/tmp/demo&prompt=hello%20world",
      { type: "new-session", directory: "/tmp/demo", prompt: "hello world" },
    ],
    ["opencode://new-session?directory=C%3A%5Crepo", { type: "new-session", directory: "C:\\repo", prompt: undefined }],
    ["opencode://open-session?id=ses_123", { type: "open-session", sessionID: "ses_123" }],
  ])("opens %s", (input, expected) => {
    expect(parseDeepLink(input)).toEqual(expected)
  })

  test.each([
    "opencode://new-session",
    "opencode://new-session?directory=",
    "opencode://open-session",
    "opencode://open-session?id=",
    "opencode://open-project?directory=/tmp/demo",
    "opencode://console/authorized?window=a",
    "https://new-session?directory=/tmp/demo",
    "not a url",
  ])("ignores %s", (input) => {
    expect(parseDeepLink(input)).toBeUndefined()
  })
})
