import { describe, expect, test } from "bun:test"
import type { ConfigInvalidError } from "./server-errors"
import { formatServerError, parseReabaleConfigInvalidError } from "./server-errors"

describe("parseReabaleConfigInvalidError", () => {
  test("formats issues with file path", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "opencode.config.ts",
        issues: [
          { path: ["settings", "host"], message: "Required" },
          { path: ["mode"], message: "Invalid" },
        ],
      },
    } satisfies ConfigInvalidError

    const result = parseReabaleConfigInvalidError(error)

    expect(result).toBe(
      ["Invalid configuration", "opencode.config.ts", "settings.host: Required", "mode: Invalid"].join("\n"),
    )
  })

  test("uses trimmed message when issues are missing", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "config",
        message: "  Bad value  ",
      },
    } satisfies ConfigInvalidError

    const result = parseReabaleConfigInvalidError(error)

    expect(result).toBe(["Invalid configuration", "Bad value"].join("\n"))
  })
})

describe("formatServerError", () => {
  test("formats config invalid errors", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        message: "Missing host",
      },
    } satisfies ConfigInvalidError

    const result = formatServerError(error)

    expect(result).toBe(["Invalid configuration", "Missing host"].join("\n"))
  })

  test("returns error messages", () => {
    expect(formatServerError(new Error("Request failed with status 503"))).toBe("Request failed with status 503")
  })

  test("returns provided string errors", () => {
    expect(formatServerError("Failed to connect to server")).toBe("Failed to connect to server")
  })

  test("falls back to unknown", () => {
    expect(formatServerError(0)).toBe("Unknown error")
  })

  test("falls back for unknown error objects and names", () => {
    expect(formatServerError({ name: "ServerTimeoutError", data: { seconds: 30 } })).toBe("Unknown error")
  })
})
