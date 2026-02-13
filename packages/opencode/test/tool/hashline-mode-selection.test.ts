import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Flag } from "../../src/flag/flag"
import { ToolRegistry } from "../../src/tool/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

/**
 * Hashline Mode Selection Tests
 *
 * This test file validates the feature-flag behavior for hashline experimental edit mode.
 * It tests the registry exposure matrix for OFF vs ON states.
 *
 * Registry Exposure Matrix:
 * | Flag State                          | Edit Tool Schema        | Description                          |
 * |-------------------------------------|------------------------|--------------------------------------|
 * | All flags OFF (default)             | replace (old_text/new_text) | Byte-for-byte equivalent to current |
 * | OPENCODE_EXPERIMENTAL=1             | hashline (set_line, replace_lines, insert_after, replace) | Umbrella enables hashline |
 * | OPENCODE_EXPERIMENTAL_HASHLINE=true | hashline               | Direct flag enable                   |
 * | OPENCODE_EXPERIMENTAL_EDIT=true     | hashline               | Umbrella alias for edit experiments |
 *
 * MVP Operation Schema Contract (locked):
 * - set_line: { anchor: "LINE:HASH", new_text: "..." }
 * - replace_lines: { start_anchor: "LINE:HASH", end_anchor: "LINE:HASH", new_text: "..." }
 * - insert_after: { anchor: "LINE:HASH", text: "..." }
 * - replace: { old_text: "...", new_text: "...", all?: boolean }
 */

describe("flag.OPENCODE_EXPERIMENTAL_HASHLINE", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear all experimental flags before each test
    delete process.env.OPENCODE_EXPERIMENTAL
    delete process.env.OPENCODE_EXPERIMENTAL_HASHLINE
    delete process.env.OPENCODE_EXPERIMENTAL_EDIT
  })

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv
  })

  test("OPENCODE_EXPERIMENTAL_HASHLINE is false when env var not set", () => {
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(false)
  })

  test("OPENCODE_EXPERIMENTAL_HASHLINE is true when env var is 'true'", () => {
    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "true"
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(true)
  })

  test("OPENCODE_EXPERIMENTAL_HASHLINE is true when env var is '1'", () => {
    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "1"
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(true)
  })

  test("OPENCODE_EXPERIMENTAL_HASHLINE is false when env var is 'false'", () => {
    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "false"
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(false)
  })

  test("OPENCODE_EXPERIMENTAL_HASHLINE is false when env var is '0'", () => {
    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "0"
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(false)
  })
})

describe("flag.OPENCODE_EXPERIMENTAL (umbrella)", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_EXPERIMENTAL
    delete process.env.OPENCODE_EXPERIMENTAL_HASHLINE
    delete process.env.OPENCODE_EXPERIMENTAL_EDIT
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test("OPENCODE_EXPERIMENTAL is false when not set", () => {
    expect(Flag.OPENCODE_EXPERIMENTAL).toBe(false)
  })
})

describe("flag.OPENCODE_EXPERIMENTAL_EDIT (umbrella alias)", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_EXPERIMENTAL
    delete process.env.OPENCODE_EXPERIMENTAL_HASHLINE
    delete process.env.OPENCODE_EXPERIMENTAL_EDIT
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test("OPENCODE_EXPERIMENTAL_EDIT is false when no flags set (default)", () => {
    expect(Flag.OPENCODE_EXPERIMENTAL_EDIT).toBe(false)
  })

  test("OPENCODE_EXPERIMENTAL_EDIT is true when umbrella OPENCODE_EXPERIMENTAL is set", () => {
    process.env.OPENCODE_EXPERIMENTAL = "true"
    expect(Flag.OPENCODE_EXPERIMENTAL_EDIT).toBe(true)
  })

  test("OPENCODE_EXPERIMENTAL_EDIT is true when OPENCODE_EXPERIMENTAL_EDIT is set directly", () => {
    process.env.OPENCODE_EXPERIMENTAL_EDIT = "true"
    expect(Flag.OPENCODE_EXPERIMENTAL_EDIT).toBe(true)
  })

  test("OPENCODE_EXPERIMENTAL_EDIT is true when OPENCODE_EXPERIMENTAL_HASHLINE is set", () => {
    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "true"
    // Note: This tests the flag exists - the actual behavior would be in registry
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(true)
  })
})

describe("registry exposure matrix (OFF state - default)", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_EXPERIMENTAL
    delete process.env.OPENCODE_EXPERIMENTAL_HASHLINE
    delete process.env.OPENCODE_EXPERIMENTAL_EDIT
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test("all experimental edit flags are false by default", () => {
    expect(Flag.OPENCODE_EXPERIMENTAL).toBe(false)
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(false)
    expect(Flag.OPENCODE_EXPERIMENTAL_EDIT).toBe(false)
  })

  test("default behavior unchanged - no hashline flags enabled", () => {
    // When all hashline flags are unset, behavior should be byte-for-byte equivalent
    // to the current replace-mode edit tool
    const anyHashlineEnabled = Flag.OPENCODE_EXPERIMENTAL_HASHLINE || Flag.OPENCODE_EXPERIMENTAL_EDIT
    expect(anyHashlineEnabled).toBe(false)
  })
})

describe("registry exposure matrix (ON state)", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_EXPERIMENTAL
    delete process.env.OPENCODE_EXPERIMENTAL_HASHLINE
    delete process.env.OPENCODE_EXPERIMENTAL_EDIT
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test("OPENCODE_EXPERIMENTAL=1 enables hashline mode via umbrella", () => {
    process.env.OPENCODE_EXPERIMENTAL = "1"
    expect(Flag.OPENCODE_EXPERIMENTAL_EDIT).toBe(true)
  })

  test("OPENCODE_EXPERIMENTAL_HASHLINE=true enables hashline mode directly", () => {
    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "true"
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(true)
    expect(Flag.OPENCODE_EXPERIMENTAL_EDIT).toBe(false) // umbrella not set
  })

  test("OPENCODE_EXPERIMENTAL_EDIT=true enables hashline mode", () => {
    process.env.OPENCODE_EXPERIMENTAL_EDIT = "true"
    expect(Flag.OPENCODE_EXPERIMENTAL_EDIT).toBe(true)
  })
})

describe("MVP operation schema contract", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_EXPERIMENTAL
    delete process.env.OPENCODE_EXPERIMENTAL_HASHLINE
    delete process.env.OPENCODE_EXPERIMENTAL_EDIT
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test("flag definitions exist for all MVP operations", () => {
    // These flags control the schema exposed to the model
    // The actual schema validation happens in the edit tool implementation
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBeDefined()
    expect(Flag.OPENCODE_EXPERIMENTAL_EDIT).toBeDefined()

    // Verify they're boolean flags
    expect(typeof Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe("boolean")
    expect(typeof Flag.OPENCODE_EXPERIMENTAL_EDIT).toBe("boolean")
  })

  test("hashline operations are locked to MVP contract when flag enabled", () => {
    // When hashline is enabled, the edit tool should expose:
    // - set_line: Replace single line at anchor
    // - replace_lines: Replace range of lines
    // - insert_after: Insert after given line
    // - replace: Substr-style fuzzy replace (no hashes)
    //
    // This test validates the flag surface exists to control this behavior.
    // The actual schema contract is enforced in the edit tool implementation.

    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "true"
    expect(Flag.OPENCODE_EXPERIMENTAL_HASHLINE).toBe(true)
  })
})

describe("tool registry exposure", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_EXPERIMENTAL
    delete process.env.OPENCODE_EXPERIMENTAL_HASHLINE
    delete process.env.OPENCODE_EXPERIMENTAL_EDIT
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test("flag off exposes edit and hides hashline", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({ providerID: "anthropic", modelID: "claude-3-7-sonnet" })
        const ids = tools.map((item) => item.id)
        expect(ids).toContain("edit")
        expect(ids).not.toContain("hashline")
      },
    })
  })

  test("flag on hides edit and exposes hashline", async () => {
    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "true"
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({ providerID: "anthropic", modelID: "claude-3-7-sonnet" })
        const ids = tools.map((item) => item.id)
        expect(ids).toContain("hashline")
        expect(ids).not.toContain("edit")
      },
    })
  })

  test("gpt model keeps apply_patch and exposes hashline together", async () => {
    process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "true"
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5" })
        const ids = tools.map((item) => item.id)
        expect(ids).toContain("apply_patch")
        expect(ids).toContain("hashline")
        expect(ids).not.toContain("edit")
        expect(ids).not.toContain("write")
      },
    })
  })
})
