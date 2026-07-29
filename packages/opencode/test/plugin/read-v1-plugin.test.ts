import { describe, expect, test } from "bun:test"
import { readV1Plugin } from "../../src/plugin/shared"

// Regression coverage for #31610:
// readV1Plugin in "detect" mode must not throw when the plugin module
// exports a default object that does not include the requested kind's
// entrypoint (e.g. a TUI-only plugin scanned by the server loader).

describe("plugin.shared.readV1Plugin detect mode", () => {
  test("returns undefined when a TUI-only plugin is scanned for kind=server", () => {
    // Given a plugin that only exports `tui` (no `server`)
    const mod = {
      default: {
        id: "tui-only",
        tui: () => ({}) as unknown,
      },
    }

    // When the server loader asks to detect whether this is a server plugin
    const result = readV1Plugin(
      mod as unknown as Record<string, unknown>,
      "tui-only-plugin",
      "server",
      "detect",
    )

    // Then it should silently skip instead of throwing
    expect(result).toBeUndefined()
  })

  test("returns undefined when a server-only plugin is scanned for kind=tui", () => {
    const mod = {
      default: {
        id: "server-only",
        server: () => ({}) as unknown,
      },
    }

    const result = readV1Plugin(
      mod as unknown as Record<string, unknown>,
      "server-only-plugin",
      "tui",
      "detect",
    )

    expect(result).toBeUndefined()
  })

  test("returns the value when the requested kind is present", () => {
    const server = () => ({ ok: true })
    const mod = {
      default: {
        id: "has-both-but-server",
        server,
      },
    }

    const result = readV1Plugin(
      mod as unknown as Record<string, unknown>,
      "plugin",
      "server",
      "detect",
    )

    expect(result).toEqual({ id: "has-both-but-server", server })
  })

  test("strict mode still throws for TUI-only plugins loaded as server", () => {
    // Sanity check: strict mode is unchanged.
    const mod = {
      default: {
        id: "tui-only",
        tui: () => ({}) as unknown,
      },
    }

    expect(() =>
      readV1Plugin(
        mod as unknown as Record<string, unknown>,
        "tui-only-plugin",
        "server",
        "strict",
      ),
    ).toThrow(/must default export an object with server/)
  })
})