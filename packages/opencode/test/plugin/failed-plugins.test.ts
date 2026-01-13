import { describe, expect, test, beforeEach } from "bun:test"
import { Plugin } from "../../src/plugin"

describe("Plugin.getFailedPlugins", () => {
  beforeEach(() => {
    Plugin._test.clearFailures()
  })

  test("returns empty array when no failures", () => {
    const failed = Plugin.getFailedPlugins()
    expect(Array.isArray(failed)).toBe(true)
    expect(failed.length).toBe(0)
  })

  test("returns tracked failures", () => {
    Plugin._test.trackFailure({
      pkg: "opencode-copilot-auth",
      version: "0.0.12",
      error: "ECONNREFUSED",
      authMethod: "GitHub Copilot OAuth",
    })

    const failed = Plugin.getFailedPlugins()
    expect(failed.length).toBe(1)
    expect(failed[0].pkg).toBe("opencode-copilot-auth")
    expect(failed[0].error).toBe("ECONNREFUSED")
  })

  test("returns a shallow copy to protect internal state", () => {
    Plugin._test.trackFailure({
      pkg: "test-pkg",
      version: "1.0.0",
      error: "test error",
      authMethod: "Test OAuth",
    })

    const first = Plugin.getFailedPlugins()
    const second = Plugin.getFailedPlugins()

    // Should be different array references
    expect(first).not.toBe(second)
    // But same content
    expect(first).toEqual(second)
  })

  test("tracks multiple failures", () => {
    Plugin._test.trackFailure({
      pkg: "opencode-copilot-auth",
      version: "0.0.12",
      error: "ECONNREFUSED",
      authMethod: "GitHub Copilot OAuth",
    })
    Plugin._test.trackFailure({
      pkg: "opencode-anthropic-auth",
      version: "0.0.8",
      error: "403 Forbidden",
      authMethod: "Anthropic OAuth (Claude Max/Pro)",
    })

    const failed = Plugin.getFailedPlugins()
    expect(failed.length).toBe(2)
    expect(failed[0].pkg).toBe("opencode-copilot-auth")
    expect(failed[1].pkg).toBe("opencode-anthropic-auth")
  })
})

describe("Plugin.getAuthDescription", () => {
  test("returns description for known plugins", () => {
    expect(Plugin.getAuthDescription("opencode-copilot-auth")).toBe("GitHub Copilot OAuth")
    expect(Plugin.getAuthDescription("opencode-anthropic-auth")).toBe("Anthropic OAuth (Claude Max/Pro)")
    expect(Plugin.getAuthDescription("@gitlab/opencode-gitlab-auth")).toBe("GitLab Duo OAuth")
  })

  test("falls back to package name for unknown plugins", () => {
    expect(Plugin.getAuthDescription("unknown-plugin")).toBe("unknown-plugin")
    expect(Plugin.getAuthDescription("my-custom-auth")).toBe("my-custom-auth")
  })
})

describe("Plugin.FailedPlugin interface", () => {
  test("has expected structure", () => {
    const failure: Plugin.FailedPlugin = {
      pkg: "test-package",
      version: "1.0.0",
      error: "Test error message",
      authMethod: "Test OAuth",
    }

    expect(failure.pkg).toBe("test-package")
    expect(failure.version).toBe("1.0.0")
    expect(failure.error).toBe("Test error message")
    expect(failure.authMethod).toBe("Test OAuth")
  })
})
