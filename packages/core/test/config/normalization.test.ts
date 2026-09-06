import { describe, expect, test } from "bun:test"
import { Duration, Schema } from "effect"
import { FastCheck } from "effect/testing"
import { ConfigNormalize } from "@opencode-ai/core/config/normalize"
import { Info } from "@opencode-ai/schema/config"

const options = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const

function normalized(input: unknown) {
  const result = ConfigNormalize.normalize(input)
  expect(result.type).toBe("normalized")
  if (result.type !== "normalized") throw new Error("expected normalized config")
  return result
}

function decoded(input: unknown) {
  return Schema.decodeUnknownSync(Info, options)(normalized(input).encoded)
}

function withoutEmptyCompatibilityContainers(input: Record<string, unknown>) {
  const result = structuredClone(input)
  if (typeof result.mcp === "object" && result.mcp !== null && !Array.isArray(result.mcp)) {
    const mcp = result.mcp as Record<string, unknown>
    const originallyEmpty = !Object.keys(mcp).length
    for (const key of ["servers", "timeout"]) {
      if (
        typeof mcp[key] === "object" &&
        mcp[key] !== null &&
        !Array.isArray(mcp[key]) &&
        !Object.keys(mcp[key]).length
      )
        delete mcp[key]
    }
    if (!originallyEmpty && !Object.keys(mcp).length) delete result.mcp
  }
  if (typeof result.compaction === "object" && result.compaction !== null && !Array.isArray(result.compaction)) {
    const compaction = result.compaction as Record<string, unknown>
    const originallyEmpty = !Object.keys(compaction).length
    if (
      typeof compaction.keep === "object" &&
      compaction.keep !== null &&
      !Array.isArray(compaction.keep) &&
      !Object.keys(compaction.keep).length
    )
      delete compaction.keep
    if (!originallyEmpty && !Object.keys(compaction).length) delete result.compaction
  }
  return result
}

describe("ConfigNormalize", () => {
  test("rejects every non-object root with one root diagnostic", () => {
    for (const input of [null, [], "config", true, 1]) {
      expect(ConfigNormalize.normalize(input)).toEqual({
        type: "rejected",
        diagnostics: [
          {
            kind: "invalid",
            path: ["$"],
            message: "rejected configuration because its root is not an object",
          },
        ],
      })
    }
  })

  test("keeps unrelated native fields when a legacy field is present", () => {
    const result = decoded({ snapshot: false, agents: { reviewer: { system: "Use V2" } } })
    expect(result.snapshots).toBe(false)
    expect(result.agents?.reviewer?.system).toBe("Use V2")
  })

  test("canonicalizes transformed native values through decode then encode", () => {
    const result = normalized({ warming: { interval: "4 minutes", duration: "30 minutes" } })
    expect(result.encoded.warming).toEqual({ interval: "240000 millis", duration: "1800000 millis" })
    const info = Schema.decodeUnknownSync(Info)(result.encoded)
    if (typeof info.warming === "boolean" || info.warming === undefined) throw new Error("expected warming info")
    expect(Duration.toMillis(info.warming.interval ?? Duration.zero)).toBe(240_000)
    expect(Duration.toMillis(info.warming.duration ?? Duration.zero)).toBe(1_800_000)
  })

  test("preserves arbitrary JSON-round-tripped native configuration", () => {
    FastCheck.assert(
      FastCheck.property(Schema.toArbitrary(Info)(FastCheck), (info) => {
        const source = JSON.parse(JSON.stringify(Schema.encodeSync(Info)(info)))
        const result = normalized(source)
        expect(Schema.decodeUnknownSync(Info)(result.encoded)).toEqual(
          Schema.decodeUnknownSync(Info)(withoutEmptyCompatibilityContainers(source)),
        )
      }),
      { numRuns: 100 },
    )
  })

  test("merges named maps by entry and gives valid native entries precedence", () => {
    const result = normalized({
      reference: { legacy: { path: "../legacy" }, duplicate: { path: "../old" } },
      references: { native: { path: "../native" }, duplicate: { path: "../new" } },
      command: { legacy: { template: "legacy" }, duplicate: { template: "old" } },
      commands: { native: { template: "native" }, duplicate: { template: "new" } },
    })
    expect(result.encoded.references).toEqual({
      legacy: { path: "../legacy" },
      native: { path: "../native" },
      duplicate: { path: "../new" },
    })
    expect(result.encoded.commands).toEqual({
      legacy: { template: "legacy" },
      native: { template: "native" },
      duplicate: { template: "new" },
    })
    expect(result.diagnostics.filter((item) => item.kind === "conflict").map((item) => item.path)).toEqual([
      ["references", "duplicate"],
      ["commands", "duplicate"],
    ])
  })

  test("does not report canonical-equal duplicates as conflicts", () => {
    const result = normalized({
      snapshot: false,
      snapshots: false,
      reference: { docs: { path: "../docs" } },
      references: { docs: { path: "../docs" } },
      agent: { reviewer: { prompt: "same" } },
      agents: { reviewer: { system: "same" } },
      provider: { custom: { name: "same" } },
      providers: { custom: { name: "same" } },
      compaction: { preserve_recent_tokens: 1000, keep: { tokens: 1000 } },
    })
    expect(result.diagnostics.filter((item) => item.kind === "conflict")).toEqual([])
  })

  test("uses agent then mode then native agent precedence", () => {
    const result = normalized({
      agent: { reviewer: { prompt: "agent" }, agentOnly: { prompt: "agent-only" } },
      mode: { reviewer: { prompt: "mode" }, modeOnly: { prompt: "mode-only" } },
      agents: { reviewer: { system: "native" }, nativeOnly: { system: "native-only" } },
    })
    expect(result.encoded.agents).toEqual({
      reviewer: { system: "native" },
      agentOnly: { system: "agent-only" },
      modeOnly: { system: "mode-only", mode: "primary" },
      nativeOnly: { system: "native-only" },
    })
    expect(result.diagnostics.filter((item) => item.kind === "conflict").map((item) => item.path)).toEqual([
      ["agents", "reviewer"],
      ["agents", "reviewer"],
    ])
    expect(() => Schema.decodeUnknownSync(Info)(result.encoded)).not.toThrow()
  })

  test("migrates the legacy small model to the title agent", () => {
    const result = normalized({ small_model: "anthropic/claude-haiku-4-5" })
    expect(result.encoded.agents).toEqual({
      title: {
        model: { providerID: "anthropic", model: "claude-haiku-4-5" },
      },
    })
    expect(result.diagnostics).toEqual([])
  })

  test("merges the legacy small model with the title agent", () => {
    const result = normalized({
      small_model: "anthropic/claude-haiku-4-5",
      agent: { title: { prompt: "Custom title prompt" } },
    })
    expect(result.encoded.agents).toEqual({
      title: {
        model: { providerID: "anthropic", model: "claude-haiku-4-5" },
        system: "Custom title prompt",
      },
    })
    expect(result.diagnostics).toEqual([])
  })

  test("omits an invalid legacy small model without exposing its value", () => {
    const secret = "do-not-log-this-value"
    const result = normalized({ small_model: secret })
    expect(result.encoded.agents).toBeUndefined()
    expect(result.diagnostics.map((item) => [item.kind, item.path])).toEqual([["unsupported", ["small_model"]]])
    expect(JSON.stringify(result.diagnostics)).not.toContain(secret)
  })

  test("recovers malformed named entries and retains a valid legacy collision", () => {
    const result = normalized({
      command: { fallback: { template: "legacy" } },
      commands: {
        fallback: { template: 1 },
        valid: { template: "native" },
        invalid: { template: false },
      },
      providers: {
        valid: { name: "Valid" },
        invalid: { env: [1] },
      },
    })
    expect(result.encoded.commands).toEqual({ fallback: { template: "legacy" }, valid: { template: "native" } })
    expect(result.encoded.providers).toEqual({ valid: { name: "Valid" } })
    expect(result.diagnostics.filter((item) => item.kind === "invalid").map((item) => item.path)).toEqual([
      ["commands", "fallback"],
      ["commands", "invalid"],
      ["providers", "invalid"],
    ])
  })

  test("uses a valid retired provider alias when the canonical legacy entry is malformed", () => {
    const result = normalized({
      provider: {
        "azure-cognitive-services": { models: { deployment: {} } },
        azure: { env: [1] },
      },
    })
    expect(result.encoded.providers).toHaveProperty("azure.models.deployment")
    expect(result.diagnostics.filter((item) => item.kind === "invalid").map((item) => item.path)).toContainEqual([
      "provider",
      "azure",
    ])
  })

  test("preserves permission source order and appends native rules", () => {
    expect(
      normalized({
        tools: { bash: true, write: false },
        permission: { read: "allow", custom: { first: "deny", second: "ask" }, task: "allow" },
        permissions: [{ action: "native", resource: "*", effect: "deny" }],
      }).encoded.permissions,
    ).toEqual([
      { action: "shell", resource: "*", effect: "allow" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "custom", resource: "first", effect: "deny" },
      { action: "custom", resource: "second", effect: "ask" },
      { action: "subagent", resource: "*", effect: "allow" },
      { action: "native", resource: "*", effect: "deny" },
    ])
  })

  test("redacts permission resource keys from invalid diagnostics", () => {
    const result = normalized({
      permission: { bash: { "curl -H Authorization:Bearer TOPSECRET *": "bogus" } },
    })
    expect(result.diagnostics).toEqual([
      {
        kind: "invalid",
        path: ["permission", "bash", "0"],
        message: "skipped malformed recognized value",
      },
    ])
    expect(JSON.stringify(result.diagnostics)).not.toContain("TOPSECRET")
  })

  test("recovers list items for skills, instructions, and permissions", () => {
    const result = normalized({
      skills: { paths: ["./skills", 1], urls: [false, "https://example.com/skills"] },
      instructions: ["one", 2, "three"],
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "read", resource: "*", effect: "invalid" },
      ],
    })
    expect(result.encoded.skills).toEqual(["./skills", "https://example.com/skills"])
    expect(result.encoded.instructions).toEqual(["one", "three"])
    expect(result.encoded.permissions).toEqual([{ action: "read", resource: "*", effect: "allow" }])
    expect(result.diagnostics.filter((item) => item.kind === "invalid")).toHaveLength(4)
  })

  test("omits malformed collection roots instead of synthesizing empty values", () => {
    const result = normalized({
      commands: [],
      providers: "invalid",
      references: false,
      agents: 1,
      permissions: {},
      instructions: {},
    })
    expect(result.encoded).toEqual({})
    expect(result.diagnostics.filter((item) => item.kind === "invalid").map((item) => item.path)).toEqual([
      ["references"],
      ["commands"],
      ["agents"],
      ["providers"],
      ["permissions"],
      ["instructions"],
    ])
  })

  test("omits all-invalid formatter and LSP maps while preserving explicit empty maps", () => {
    const invalid = normalized({
      formatter: { prettier: { command: [1] } },
      lsp: { typescript: { command: [1] } },
    })
    expect(invalid.encoded).not.toHaveProperty("formatter")
    expect(invalid.encoded).not.toHaveProperty("lsp")
    expect(invalid.diagnostics.filter((item) => item.kind === "invalid").map((item) => item.path)).toEqual([
      ["formatter", "prettier"],
      ["lsp", "typescript"],
    ])

    expect(normalized({ formatter: {}, lsp: {} }).encoded).toMatchObject({ formatter: {}, lsp: {} })
  })

  test("combines legacy and native MCP servers and merges timeout leaves", () => {
    const result = normalized({
      experimental: { mcp_timeout: 5000 },
      mcp: {
        legacy: { type: "local", command: ["legacy"] },
        duplicate: { type: "remote", url: "https://legacy.example.com" },
        servers: {
          native: { type: "local", command: ["native"] },
          duplicate: { type: "remote", url: "https://native.example.com" },
          invalid: { type: "local", command: [1] },
        },
        timeout: { startup: 1000, catalog: 6000 },
      },
    })
    expect(result.encoded.mcp).toEqual({
      timeout: { catalog: 6000, execution: 5000, startup: 1000 },
      servers: {
        legacy: { type: "local", command: ["legacy"], disabled: undefined, timeout: undefined },
        duplicate: { type: "remote", url: "https://native.example.com" },
        native: { type: "local", command: ["native"] },
      },
    })
    expect(
      result.diagnostics.some((item) => item.kind === "conflict" && item.path.join(".") === "mcp.servers.duplicate"),
    ).toBe(true)
    expect(
      result.diagnostics.some((item) => item.kind === "conflict" && item.path.join(".") === "mcp.timeout.catalog"),
    ).toBe(true)
    expect(
      result.diagnostics.some((item) => item.kind === "invalid" && item.path.join(".") === "mcp.servers.invalid"),
    ).toBe(true)
  })

  test("uses raw MCP discriminators for reserved server names", () => {
    const result = normalized({
      mcp: {
        servers: { type: "local", command: ["reserved-servers"] },
        timeout: { type: "remote", url: "https://reserved.example.com" },
      },
    })
    expect((result.encoded.mcp as { servers: Record<string, unknown> }).servers).toEqual({
      servers: { type: "local", command: ["reserved-servers"], disabled: undefined, timeout: undefined },
      timeout: { type: "remote", url: "https://reserved.example.com", disabled: undefined, timeout: undefined },
    })

    const enabledOnly = normalized({ mcp: { servers: { enabled: true }, timeout: { enabled: false } } })
    expect(enabledOnly.encoded.mcp).toBeUndefined()
    expect(enabledOnly.diagnostics.map((item) => [item.kind, item.path])).toEqual([
      ["unsupported", ["mcp", "servers"]],
      ["unsupported", ["mcp", "timeout"]],
    ])
  })

  test("normalizes MCP timeout fields in schema order with per-leaf recovery", () => {
    const result = normalized({ mcp: { timeout: { execution: 3000, startup: "invalid", catalog: 2000 } } })

    expect(result.encoded.mcp).toEqual({ timeout: { catalog: 2000, execution: 3000 } })
    expect(result.diagnostics.map((item) => [item.kind, item.path])).toEqual([
      ["invalid", ["mcp", "timeout", "startup"]],
    ])
    expect(normalized({ mcp: { timeout: {} } }).encoded.mcp).toBeUndefined()

    const unknown = normalized({ mcp: { timeout: { unknown: 1000 } } })
    expect(unknown.encoded.mcp).toBeUndefined()
    expect(unknown.diagnostics.map((item) => [item.kind, item.path])).toEqual([["invalid", ["mcp", "timeout"]]])
  })

  test("merges bounded compaction leaves and omits unsupported leaves", () => {
    const result = normalized({
      compaction: {
        auto: false,
        preserve_recent_tokens: 1000,
        keep: { tokens: 2000 },
        reserved: 3000,
        buffer: 4000,
        tail_turns: 2,
        prune: true,
      },
    })
    expect(result.encoded.compaction).toEqual({ auto: false, keep: { tokens: 2000 }, buffer: 4000 })
    expect(result.diagnostics.map((item) => [item.kind, item.path])).toEqual([
      ["unsupported", ["compaction", "tail_turns"]],
      ["unsupported", ["compaction", "prune"]],
      ["conflict", ["compaction", "keep", "tokens"]],
      ["conflict", ["compaction", "buffer"]],
    ])
  })

  test("distinguishes empty, mixed, and wholly malformed enabled provider lists", () => {
    expect(normalized({ enabled_providers: [] }).encoded.experimental).toEqual({
      policies: [{ action: "provider.use", resource: "*", effect: "deny" }],
    })
    expect(normalized({ enabled_providers: [1, "anthropic", false] }).encoded.experimental).toEqual({
      policies: [
        { action: "provider.use", resource: "*", effect: "deny" },
        { action: "provider.use", resource: "anthropic", effect: "allow" },
      ],
    })
    expect(normalized({ enabled_providers: [1, false] }).encoded.experimental).toBeUndefined()
    expect(normalized({ enabled_providers: "anthropic" }).encoded.experimental).toBeUndefined()
  })

  test("appends native policies after migrated provider policies", () => {
    expect(
      normalized({
        enabled_providers: ["anthropic"],
        disabled_providers: ["openai"],
        experimental: {
          portable_shell_scanner: true,
          subagent_depth: 0,
          policies: [{ action: "provider.use", resource: "custom", effect: "allow" }],
        },
      }).encoded.experimental,
    ).toEqual({
      portable_shell_scanner: true,
      subagent_depth: 0,
      policies: [
        { action: "provider.use", resource: "*", effect: "deny" },
        { action: "provider.use", resource: "anthropic", effect: "allow" },
        { action: "provider.use", resource: "openai", effect: "deny" },
        { action: "provider.use", resource: "custom", effect: "allow" },
      ],
    })
  })

  test("reports unsupported legacy settings without including their values", () => {
    const secret = "do-not-log-this-value"
    const result = normalized({
      logLevel: "DEBUG",
      agent: { reviewer: { name: secret, prompt: "review" } },
      provider: {
        custom: {
          id: secret,
          whitelist: ["model"],
          models: {
            model: {
              release_date: secret,
              status: "active",
              interleaved: true,
            },
          },
        },
      },
      experimental: { openTelemetry: true },
    })
    expect(result.diagnostics.filter((item) => item.kind === "unsupported").map((item) => item.path)).toEqual([
      ["logLevel"],
      ["agent", "reviewer", "name"],
      ["provider", "custom", "id"],
      ["provider", "custom", "whitelist"],
      ["provider", "custom", "models", "model", "release_date"],
      ["provider", "custom", "models", "model", "status"],
      ["provider", "custom", "models", "model", "interleaved"],
      ["experimental", "openTelemetry"],
    ])
    expect(JSON.stringify(result.diagnostics)).not.toContain(secret)
  })

  test("diagnoses unsupported legacy model selections without dropping their entries", () => {
    const result = normalized({
      command: {
        invalidModel: { template: "one", model: "invalid" },
        invalidVariant: { template: "two", model: "anthropic/model", variant: "bad#variant" },
        missingModel: { template: "three", variant: "high" },
      },
      agent: { invalid: { prompt: "agent", model: "invalid", variant: "" } },
    })
    expect(Object.keys(result.encoded.commands as Record<string, unknown>)).toEqual([
      "invalidModel",
      "invalidVariant",
      "missingModel",
    ])
    expect(Object.keys(result.encoded.agents as Record<string, unknown>)).toEqual(["invalid"])
    expect(result.diagnostics.filter((item) => item.kind === "unsupported").map((item) => item.path)).toEqual([
      ["command", "invalidModel", "model"],
      ["command", "invalidVariant", "variant"],
      ["command", "missingModel", "variant"],
      ["agent", "invalid", "model"],
      ["agent", "invalid", "variant"],
    ])
  })

  test("invalid legacy provider overlays skip only that provider", () => {
    const result = normalized({
      provider: {
        headers: { options: { headers: { valid: "yes", invalid: 1 } } },
        body: { options: { body: "not-an-object" } },
        valid: { options: { headers: { valid: "yes" }, body: { trace: true } } },
      },
    })
    expect(result.encoded.providers).toEqual({
      valid: { settings: {}, headers: { valid: "yes" }, body: { trace: true } },
    })
    expect(result.diagnostics.filter((item) => item.kind === "invalid").map((item) => item.path)).toEqual([
      ["provider", "headers", "options", "headers"],
      ["provider", "body", "options", "body"],
    ])
  })

  test("preserves explicit false, zero, empty list, and empty map presence", () => {
    const result = normalized({
      snapshot: false,
      autoshare: false,
      references: {},
      commands: {},
      agents: {},
      providers: {},
      instructions: [],
      experimental: { subagent_depth: 0 },
    })
    expect(result.encoded).toMatchObject({
      snapshots: false,
      references: {},
      commands: {},
      agents: {},
      providers: {},
      instructions: [],
      experimental: { subagent_depth: 0 },
    })
    expect(result.encoded.share).toBeUndefined()
  })
})
