import { ConfigMCP } from "@opencode-ai/core/v1/config/mcp"
import { test, expect, describe } from "bun:test"
import { Schema } from "effect"

// Guards the diagnostics for malformed MCP entries (#198). The schema rejects
// entries that carry extra keys next to `enabled`, and `entryIssues` is what
// turns the remaining bad shapes into messages that name what would be lost.

const decode = Schema.decodeUnknownExit(ConfigMCP.Entry)

describe("ConfigMCP.entryIssues", () => {
  test("reports the entry that pairs `enabled` with a definition", () => {
    const entry = { command: ["npx", "-y", "server"], enabled: true }

    // The strict disable shorthand refuses to carry a half-written definition.
    expect(decode(entry)._tag).toBe("Failure")

    // entryIssues is what makes it loud, and it names what would be lost.
    const issues = ConfigMCP.entryIssues(entry)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('missing "type"')
    expect(issues[0]).toContain("command")
    expect(issues[0]).toContain("discarded")
  })

  test("flags `env` on a local entry, which decodes cleanly and is thrown away", () => {
    const entry = { type: "local", command: ["npx"], env: { TOKEN: "x" } }

    const decoded = decode(entry)
    expect(decoded._tag).toBe("Success")
    expect(decoded._tag === "Success" && decoded.value).toEqual({ type: "local", command: ["npx"] })

    // The nastiest case: the server starts, then fails at runtime for an
    // unrelated-looking reason because its token never made it through.
    expect(ConfigMCP.entryIssues(entry)).toEqual([`unknown key "env" — did you mean "environment"?`])
  })

  test("translates type names borrowed from other MCP clients", () => {
    expect(ConfigMCP.entryIssues({ type: "stdio", command: ["npx"] })).toEqual([
      `unknown type "stdio" — this project calls that "local"`,
    ])
    expect(ConfigMCP.entryIssues({ type: "sse", url: "https://x" })).toEqual([
      `unknown type "sse" — this project calls that "remote"`,
    ])
    expect(ConfigMCP.entryIssues({ type: "streamable-http", url: "https://x" })).toEqual([
      `unknown type "streamable-http" — this project calls that "remote"`,
    ])
  })

  test("names an unrecognised type instead of guessing", () => {
    expect(ConfigMCP.entryIssues({ type: "grpc", url: "https://x" })).toEqual([
      `unknown type "grpc" — expected "local" or "remote"`,
    ])
  })

  test("points a typeless entry at the type its other keys imply", () => {
    expect(ConfigMCP.entryIssues({ command: ["npx"] })[0]).toContain(`entries with a "command" are "local"`)
    expect(ConfigMCP.entryIssues({ url: "https://x" })[0]).toContain(`entries with a "url" are "remote"`)
  })

  test("keeps the legacy `{ enabled: false }` disable shorthand working", () => {
    expect(ConfigMCP.entryIssues({ enabled: false })).toEqual([])

    const decoded = decode({ enabled: false })
    expect(decoded._tag === "Success" && decoded.value).toEqual({ enabled: false })
  })

  test("rejects `{ enabled: true }` alone, which defines no server at all", () => {
    // This is the shape our own docs demonstrated; it decodes and then does nothing.
    expect(ConfigMCP.entryIssues({ enabled: true })[0]).toContain("does not define a server")
  })

  test("leaves a non-boolean `enabled` to the schema rather than double-reporting", () => {
    expect(ConfigMCP.entryIssues({ enabled: "yes" })).toEqual([])
    expect(decode({ enabled: "yes" })._tag).toBe("Failure")
  })

  test("accepts every documented well-formed entry", () => {
    expect(ConfigMCP.entryIssues({ type: "local", command: ["npx", "-y", "x"] })).toEqual([])
    expect(
      ConfigMCP.entryIssues({
        type: "local",
        command: ["npx"],
        environment: { A: "b" },
        enabled: false,
        timeout: 1000,
      }),
    ).toEqual([])
    expect(
      ConfigMCP.entryIssues({
        type: "remote",
        url: "https://x",
        headers: { A: "b" },
        oauth: false,
        enabled: true,
        timeout: 1000,
      }),
    ).toEqual([])
  })

  test("reports a remote key used on a local entry", () => {
    expect(ConfigMCP.entryIssues({ type: "local", command: ["npx"], url: "https://x" })).toEqual([
      `unknown key "url" — expected one of: type, command, environment, enabled, timeout`,
    ])
  })

  test("rejects a non-object entry", () => {
    expect(ConfigMCP.entryIssues("npx -y server")[0]).toContain("must be an object")
    expect(ConfigMCP.entryIssues(null)[0]).toContain("must be an object")
    expect(ConfigMCP.entryIssues([])[0]).toContain("must be an object")
  })
})

describe("ConfigMCP.issues", () => {
  test("keys every problem by server name and leaves good entries out", () => {
    expect(
      ConfigMCP.issues({
        good: { type: "local", command: ["npx"] },
        off: { enabled: false },
        vanishing: { command: ["npx"], enabled: true },
        typo: { type: "local", command: ["npx"], env: {} },
      }),
    ).toEqual([
      { key: "vanishing", message: expect.stringContaining('missing "type"') },
      { key: "typo", message: expect.stringContaining(`did you mean "environment"`) },
    ])
  })

  test("ignores a missing or non-record `mcp` section", () => {
    expect(ConfigMCP.issues(undefined)).toEqual([])
    expect(ConfigMCP.issues({})).toEqual([])
    expect(ConfigMCP.issues("nope")).toEqual([])
  })
})
