import { describe, expect, test } from "bun:test"
import { sanitizePluginEnv, userPluginEnvAllowlist } from "@/util/plugin-env"

describe("sanitizePluginEnv", () => {
  test("keeps allowlisted configuration and credential names", () => {
    const input = {
      OPENCODE_CONFIG: "x",
      API_TOKEN: "secret",
      AWS_ACCOUNT: "123",
      MCP_LIFECYCLE_PID_FILE: "/tmp/pid",
      TZ: "UTC",
      NODE_ENV: "production",
    }

    expect(sanitizePluginEnv(input)).toEqual({ env: input, dropped: [] })
  })

  test("drops loader and toolchain names that could execute code", () => {
    const dropped = [
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "NODE_EXTRA_CA_CERTS",
      "LD_PRELOAD",
      "ZDOTDIR",
      "SSH_AUTH_SOCK",
      "PYTHONPATH",
      "VIRTUAL_ENV",
      "AWS_PROFILE",
      "HOME",
      "PATH",
      "NODE_OPTIONS",
    ]
    const input = Object.fromEntries(dropped.map((key) => [key, "danger"]))
    Object.assign(input, { OPENCODE_SAFE: "ok" })

    const result = sanitizePluginEnv(input)

    expect(result.env).toEqual({ OPENCODE_SAFE: "ok" })
    expect(result.dropped).toEqual(dropped)
  })

  test("reports names only, never dropped values", () => {
    const result = sanitizePluginEnv({ LD_PRELOAD: "/tmp/evil.so", SECRET_VALUE_XYZ: "super-secret" })

    expect(result.dropped).toContain("LD_PRELOAD")
    expect(result.dropped.join("\n")).not.toContain("super-secret")
    expect(result.dropped.join("\n")).not.toContain("/tmp/evil.so")
  })

  test("a caller-supplied allow set widens the built-in allowlist", () => {
    const allow = new Set(["PYTHONPATH"])
    const result = sanitizePluginEnv({ PYTHONPATH: "/opt/lib", LD_PRELOAD: "x" }, allow)

    expect(result.env).toEqual({ PYTHONPATH: "/opt/lib" })
    expect(result.dropped).toEqual(["LD_PRELOAD"])
  })

  test("drops names that are not valid environment identifiers", () => {
    const result = sanitizePluginEnv({ "BAD NAME": "x", OPENCODE_OK: "y" })

    expect(result.env).toEqual({ OPENCODE_OK: "y" })
    expect(result.dropped).toEqual(["BAD NAME"])
  })
})

describe("userPluginEnvAllowlist", () => {
  test("parses a comma-separated list, upper-casing and ignoring invalid names", () => {
    const allow = userPluginEnvAllowlist({ OPENCODE_PLUGIN_ENV_ALLOW: "pythonpath, AWS_PROFILE ,bad name," })

    expect([...allow].sort()).toEqual(["AWS_PROFILE", "PYTHONPATH"])
  })

  test("is empty when the escape hatch is unset", () => {
    expect(userPluginEnvAllowlist({})).toEqual(new Set())
  })
})
