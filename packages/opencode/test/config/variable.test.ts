import { test, expect, describe } from "bun:test"
import { ConfigVariable } from "@/config/variable"
import { NamedError } from "@opencode-ai/core/util/error"

const source = { type: "path", path: "/tmp/opencode.json" } as const

async function rejection(text: string, extra?: Parameters<typeof ConfigVariable.substitute>[0]) {
  try {
    await ConfigVariable.substitute({ text, ...source, ...extra })
  } catch (error) {
    return error
  }
  throw new Error("expected substitute to reject, but it resolved")
}

describe("ConfigVariable.substitute {env:} missing handling", () => {
  const MISSING = "OPENCODE_TEST_MISSING_VAR_XYZ"
  const SET = "OPENCODE_TEST_SET_VAR_XYZ"

  test("missing env var throws ConfigInvalidError naming the var in the default (error) mode", async () => {
    delete process.env[MISSING]
    const error = await rejection(`{"username":"{env:${MISSING}}"}`)
    expect(NamedError.hasName(error, "ConfigInvalidError")).toBe(true)
    expect((error as { data: { message: string } }).data.message).toContain(MISSING)
  })

  test("missing env var resolves to empty string in empty mode", async () => {
    delete process.env[MISSING]
    const out = await ConfigVariable.substitute({
      text: `{"username":"{env:${MISSING}}"}`,
      ...source,
      missing: "empty",
    })
    expect(out).toBe(`{"username":""}`)
  })

  test("set env var resolves to its value (happy path, error mode)", async () => {
    process.env[SET] = "resolved-value"
    try {
      const out = await ConfigVariable.substitute({ text: `{"username":"{env:${SET}}"}`, ...source })
      expect(out).toBe(`{"username":"resolved-value"}`)
    } finally {
      delete process.env[SET]
    }
  })

  test("explicit input.env override resolves and counts as present", async () => {
    delete process.env[MISSING]
    const out = await ConfigVariable.substitute({
      text: `{"username":"{env:${MISSING}}"}`,
      ...source,
      env: { [MISSING]: "from-input-env" },
    })
    expect(out).toBe(`{"username":"from-input-env"}`)
  })

  test("error names every missing variable when several are absent", async () => {
    delete process.env["OPENCODE_TEST_MISSING_A"]
    delete process.env["OPENCODE_TEST_MISSING_B"]
    const error = await rejection(`{"a":"{env:OPENCODE_TEST_MISSING_A}","b":"{env:OPENCODE_TEST_MISSING_B}"}`)
    const message = (error as { data: { message: string } }).data.message
    expect(message).toContain("OPENCODE_TEST_MISSING_A")
    expect(message).toContain("OPENCODE_TEST_MISSING_B")
  })

  test("an unset env var in a wrapped MCP server's environment map fails loudly", async () => {
    // Repro of the original symptom: a wrapped remote MCP server stores
    // {env:USER_TOKEN} in its environment map; an unset USER_TOKEN must surface
    // at config load, not as an opaque downstream gateway -32000.
    delete process.env["OPENCODE_TEST_USER_TOKEN"]
    const text = JSON.stringify({
      mcp: {
        wrapped: {
          type: "local",
          command: ["npx", "-y", "@onyxsecurity/mcp-gateway"],
          environment: { MCP_GATEWAY_HEADER_AUTHORIZATION: "{env:OPENCODE_TEST_USER_TOKEN}" },
        },
      },
    })
    const error = await rejection(text)
    expect(NamedError.hasName(error, "ConfigInvalidError")).toBe(true)
    expect((error as { data: { message: string } }).data.message).toContain("OPENCODE_TEST_USER_TOKEN")
  })

  test("missing {file:} still throws (unchanged) — env change did not regress it", async () => {
    const error = await rejection(`{"x":"{file:./definitely-missing-file.txt}"}`)
    expect(NamedError.hasName(error, "ConfigInvalidError")).toBe(true)
  })
})
