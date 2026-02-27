import { describe, expect, test } from "bun:test"
import { extractDirectory, buildTokenPersistCommand, buildShellCommand } from "./session-header-actions-helpers"

describe("extractDirectory", () => {
  test("returns string as-is", () => {
    expect(extractDirectory("/home/ubuntu/projects/app")).toBe("/home/ubuntu/projects/app")
  })

  test("returns first element from array", () => {
    expect(extractDirectory(["/home/ubuntu/projects/app", "/home/ubuntu/projects/other"])).toBe(
      "/home/ubuntu/projects/app",
    )
  })

  test("returns single element from array", () => {
    expect(extractDirectory(["/home/ubuntu/projects/app"])).toBe("/home/ubuntu/projects/app")
  })

  test("returns null for empty array", () => {
    expect(extractDirectory([])).toBeNull()
  })

  test("returns null for null input", () => {
    expect(extractDirectory(null)).toBeNull()
  })
})

describe("buildTokenPersistCommand", () => {
  test("returns mkdir + write command when token is provided", () => {
    const result = buildTokenPersistCommand("my-token-123")
    expect(result).toContain("mkdir -p ~/.config/laterapi")
    expect(result).toContain("> ~/.config/laterapi/token")
    expect(result).toContain("$LATERAPI_KEY")
    expect(result).toEndWith("&& ")
  })

  test("returns empty string when token is empty", () => {
    expect(buildTokenPersistCommand("")).toBe("")
  })

  test("does not embed the token value directly in the command", () => {
    const result = buildTokenPersistCommand("secret-token-value")
    expect(result).not.toContain("secret-token-value")
    expect(result).toContain("$LATERAPI_KEY")
  })

  test("uses printf to avoid newline in token file", () => {
    const result = buildTokenPersistCommand("token")
    expect(result).toContain("printf")
  })
})

describe("buildShellCommand", () => {
  test("wraps command in sh -c", () => {
    const result = buildShellCommand("latervibe", ["start", "--wait"], "")
    expect(result.command).toBe("sh")
    expect(result.args).toEqual(["-c", "latervibe start --wait"])
  })

  test("prepends prefix to command", () => {
    const prefix = "mkdir -p ~/.config/laterapi && "
    const result = buildShellCommand("latervibe", ["start"], prefix)
    expect(result.args).toEqual(["-c", "mkdir -p ~/.config/laterapi && latervibe start"])
  })

  test("handles empty args", () => {
    const result = buildShellCommand("echo", [], "")
    expect(result.args).toEqual(["-c", "echo"])
  })

  test("handles empty prefix", () => {
    const result = buildShellCommand("ls", ["-la"], "")
    expect(result.args).toEqual(["-c", "ls -la"])
  })

  test("combines persist prefix with actual command", () => {
    const prefix = buildTokenPersistCommand("token")
    const result = buildShellCommand("latervibe", ["start", "--wait"], prefix)
    expect(result.command).toBe("sh")
    expect(result.args[0]).toBe("-c")
    expect(result.args[1]).toContain("mkdir -p ~/.config/laterapi")
    expect(result.args[1]).toEndWith("latervibe start --wait")
  })
})
