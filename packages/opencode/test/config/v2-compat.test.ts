import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import { Effect, Layer, Logger } from "effect"
import { HttpClient } from "effect/unstable/http"
import path from "path"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { ConfigParse } from "../../src/config/parse"
import { ConfigV2Compat } from "../../src/config/v2-compat"
import { Env } from "../../src/env"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const source = "test:v2-compat"
const lower = (input: unknown) => ConfigParse.schema(ConfigV1.Info, ConfigV2Compat.lower(input, source).value, source)

const it = testEffect(
  LayerNode.compile(LayerNode.group([Config.node, FSUtil.node, Env.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [
      httpClient,
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => Effect.die(`unexpected http request: ${request.method} ${request.url}`)),
      ),
    ],
  ]),
)

describe("ConfigV2Compat.lower", () => {
  test("returns structured invalid diagnostics while retaining supported siblings", () => {
    const result = ConfigV2Compat.lower({
      mcp: {
        servers: {
          broken: { type: "local", command: "not-an-array" },
          working: { type: "local", command: ["working-mcp"] },
        },
      },
      agents: { broken: { steps: "many" } },
      commands: { broken: { template: 42 } },
    })

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "invalid", path: ["mcp", "servers", "broken"] }),
        expect.objectContaining({ kind: "invalid", path: ["agents", "broken"] }),
        expect.objectContaining({ kind: "invalid", path: ["commands", "broken"] }),
      ]),
    )
    expect(ConfigParse.schema(ConfigV1.Info, result.value, source).mcp).toEqual({
      working: { type: "local", command: ["working-mcp"], enabled: true },
    })
  })

  test("reports unsupported settings and lossy conversions without their values", () => {
    const secret = "do-not-log-credentials"
    const result = ConfigV2Compat.lower({
      model: { providerID: "example", model: "model", variant: "high" },
      plugins: [{ package: "native-plugin", options: { token: secret } }],
      providers: { example: { settings: { apiKey: secret } } },
      websearch: secret,
      warming: true,
      experimental: { portable_shell_scanner: true },
      agents: { reviewer: { request: { headers: { Authorization: secret } } } },
      mcp: {
        servers: {
          remote: {
            type: "remote",
            url: `https://example.com/?token=${secret}`,
            oauth: { client_secret: secret },
            codemode: false,
            timeout: { execution: 60000 },
          },
        },
      },
      lsp: { custom: { command: ["custom-lsp"] } },
    })

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "unsupported", path: ["model", "variant"] }),
        expect.objectContaining({ kind: "unsupported", path: ["plugins"] }),
        expect.objectContaining({ kind: "unsupported", path: ["providers"] }),
        expect.objectContaining({ kind: "unsupported", path: ["websearch"] }),
        expect.objectContaining({ kind: "unsupported", path: ["warming"] }),
        expect.objectContaining({ kind: "unsupported", path: ["experimental", "portable_shell_scanner"] }),
        expect.objectContaining({ kind: "unsupported", path: ["agents", "reviewer", "request", "headers"] }),
        expect.objectContaining({ kind: "unsupported", path: ["mcp", "servers", "remote", "codemode"] }),
        expect.objectContaining({ kind: "unsupported", path: ["mcp", "servers", "remote", "timeout"] }),
        expect.objectContaining({ kind: "unsupported", path: ["lsp", "custom"] }),
      ]),
    )
    expect(JSON.stringify(result.diagnostics)).not.toContain(secret)
  })

  test("reports conflicting forms while retaining the V1 value", () => {
    const result = ConfigV2Compat.lower({
      snapshot: false,
      snapshots: true,
      command: { review: { template: "Legacy review" } },
      commands: { review: { template: "Native review" } },
      mcp: {
        shared: { type: "local", command: ["legacy"] },
        servers: { shared: { type: "local", command: ["native"] } },
      },
    })
    const config = ConfigParse.schema(ConfigV1.Info, result.value, source)

    expect(config.snapshot).toBe(false)
    expect(config.command?.review.template).toBe("Legacy review")
    expect(config.mcp?.shared).toEqual({ type: "local", command: ["legacy"] })
    expect(result.diagnostics.filter((item) => item.kind === "conflict")).toHaveLength(3)
  })

  test("does not diagnose ordinary V1 configuration or reject invalid V1 roots early", () => {
    expect(ConfigV2Compat.lower({ snapshot: false, mcp: { existing: { enabled: false } } }).diagnostics).toEqual([])
    expect(ConfigV2Compat.lower({ snapshot: false, snapshots: false }).diagnostics).toEqual([])
    const result = ConfigV2Compat.lower(null)
    expect(result.value).toBeNull()
    expect(() => ConfigParse.schema(ConfigV1.Info, result.value, source)).toThrow()
    expect(() => lower({ snapshot: "invalid", snapshots: true })).toThrow()
  })

  test("keeps malformed MCP servers named servers and timeout for V1 validation", () => {
    expect(() => lower({ mcp: { servers: { type: "local", command: "invalid" } } })).toThrow()
    expect(() => lower({ mcp: { timeout: { type: "remote", url: 42 } } })).toThrow()
    expect(() => lower({ mcp: { servers: { type: "bogus" } } })).toThrow()
    expect(() => lower({ mcp: { servers: { type: 42 } } })).toThrow()
    expect(() => lower({ mcp: { servers: { enabled: "false" } } })).toThrow()
    expect(lower({ mcp: { servers: { enabled: false }, timeout: { enabled: true } } }).mcp).toEqual({
      servers: { enabled: false },
      timeout: { enabled: true },
    })
    expect(lower({ mcp: { servers: { type: {}, enabled: false } } }).mcp).toEqual({
      servers: { enabled: false },
    })
  })

  test("preserves V1 enablement when flat MCP entries include V2 fields", () => {
    expect(
      lower({
        mcp: {
          disabled: { type: "local", command: ["legacy"], enabled: false, codemode: false },
          enabled: { type: "local", command: ["legacy"], enabled: true, disabled: true },
        },
      }).mcp,
    ).toEqual({
      disabled: { type: "local", command: ["legacy"], enabled: false },
      enabled: { type: "local", command: ["legacy"], enabled: true },
    })
    expect(() =>
      lower({ mcp: { invalid: { type: "local", command: ["legacy"], enabled: "false", codemode: false } } }),
    ).toThrow("ConfigInvalidError")
  })

  test("accepts enveloped servers named type and enabled", () => {
    expect(
      lower({
        mcp: {
          servers: {
            type: { type: "local", command: ["type-mcp"] },
            enabled: { type: "remote", url: "https://example.com/mcp" },
          },
        },
      }).mcp,
    ).toEqual({
      type: { type: "local", command: ["type-mcp"], enabled: true },
      enabled: { type: "remote", url: "https://example.com/mcp", enabled: true },
    })
  })

  test("does not repair malformed V1 containers or shadowed entries with V2 values", () => {
    const cases = [
      { agent: null, agents: { reviewer: { system: "Native prompt" } } },
      { command: [], commands: { review: { template: "Native command" } } },
      { attachment: false, media: { image: { auto_resize: true } } },
      { experimental: null, mcp: { timeout: { catalog: 3000, execution: 3000 } } },
      { agent: { reviewer: 42 }, agents: { reviewer: { system: "Native prompt" } } },
      { command: { review: 42 }, commands: { review: { template: "Native command" } } },
      { mcp: { shared: 42, servers: { shared: { type: "local", command: ["native"] } } } },
    ]
    cases.forEach((input) => expect(() => lower(input)).toThrow("ConfigInvalidError"))
  })

  test("keeps secrets out of invalid and conflict diagnostics", () => {
    const secret = "secret-never-in-diagnostics"
    const result = ConfigV2Compat.lower({
      commands: { malformed: { template: { token: secret } } },
      mcp: {
        shared: { type: "remote", url: "https://example.com", headers: { Authorization: secret } },
        servers: {
          shared: { type: "remote", url: "https://example.com", headers: { Authorization: `${secret}-changed` } },
          malformed: { type: "remote", url: `https://example.com?token=${secret}`, disabled: secret },
        },
      },
    })

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "conflict", path: ["mcp", "servers", "shared"] }),
        expect.objectContaining({ kind: "invalid", path: ["commands", "malformed"] }),
        expect.objectContaining({ kind: "invalid", path: ["mcp", "servers", "malformed"] }),
      ]),
    )
    expect(JSON.stringify(result.diagnostics)).not.toContain(secret)
  })

  test("merges flat V1 and nested V2 MCP servers, with legacy definitions winning", () => {
    const config = lower({
      mcp: {
        legacy: { type: "local", command: ["legacy-mcp"], enabled: false },
        shared: { type: "remote", url: "https://legacy.example.com/mcp" },
        servers: {
          shared: { type: "remote", url: "https://native.example.com/mcp", disabled: false },
          native: { type: "local", command: ["native-mcp"], disabled: true },
        },
      },
    })

    expect(config.mcp).toEqual({
      legacy: { type: "local", command: ["legacy-mcp"], enabled: false },
      shared: { type: "remote", url: "https://legacy.example.com/mcp" },
      native: { type: "local", command: ["native-mcp"], enabled: false },
    })
  })

  test("preserves flat MCP servers named servers and timeout", () => {
    const config = lower({
      mcp: {
        servers: { type: "local", command: ["server-named-servers"] },
        timeout: { type: "remote", url: "https://timeout.example.com/mcp" },
      },
    })

    expect(config.mcp).toEqual({
      servers: { type: "local", command: ["server-named-servers"] },
      timeout: { type: "remote", url: "https://timeout.example.com/mcp" },
    })
  })

  test("preserves enabled-only V1 MCP entries and existing enabled states", () => {
    const config = lower({
      mcp: {
        disabled: { enabled: false },
        enabled: { enabled: true },
        existing: { type: "local", command: ["existing-mcp"], enabled: true },
      },
    })

    expect(config.mcp).toEqual({
      disabled: { enabled: false },
      enabled: { enabled: true },
      existing: { type: "local", command: ["existing-mcp"], enabled: true },
    })
  })

  test("inverts explicit V2 disabled states and enables servers by default", () => {
    const config = lower({
      mcp: {
        servers: {
          implicit: { type: "remote", url: "https://implicit.example.com/mcp" },
          enabled: { type: "local", command: ["enabled-mcp"], disabled: false },
          disabled: { type: "local", command: ["disabled-mcp"], disabled: true },
        },
      },
    })

    expect(config.mcp?.implicit).toEqual({ type: "remote", url: "https://implicit.example.com/mcp", enabled: true })
    expect(config.mcp?.enabled).toEqual({ type: "local", command: ["enabled-mcp"], enabled: true })
    expect(config.mcp?.disabled).toEqual({ type: "local", command: ["disabled-mcp"], enabled: false })
  })

  test("lowers OAuth field names and preserves disabled OAuth", () => {
    const config = lower({
      mcp: {
        servers: {
          authenticated: {
            type: "remote",
            url: "https://oauth.example.com/mcp",
            headers: { Authorization: "Bearer token" },
            oauth: {
              client_id: "client",
              client_secret: "secret",
              scope: "read write",
              callback_port: 19877,
              redirect_uri: "http://127.0.0.1:19877/callback",
            },
          },
          anonymous: { type: "remote", url: "https://anonymous.example.com/mcp", oauth: false },
        },
      },
    })

    expect(config.mcp?.authenticated).toEqual({
      type: "remote",
      url: "https://oauth.example.com/mcp",
      headers: { Authorization: "Bearer token" },
      enabled: true,
      oauth: {
        clientId: "client",
        clientSecret: "secret",
        scope: "read write",
        callbackPort: 19877,
        redirectUri: "http://127.0.0.1:19877/callback",
      },
    })
    expect(config.mcp?.anonymous).toEqual({
      type: "remote",
      url: "https://anonymous.example.com/mcp",
      enabled: true,
      oauth: false,
    })
  })

  test("lowers matching catalog and execution timeouts without collapsing incompatible phases", () => {
    const config = lower({
      mcp: {
        timeout: { catalog: 8000, execution: 8000 },
        servers: {
          safe: { type: "local", command: ["safe-mcp"], timeout: { catalog: 3000, execution: 3000 } },
          unsafe: { type: "local", command: ["unsafe-mcp"], timeout: { catalog: 2000, execution: 4000 } },
          partial: { type: "local", command: ["partial-mcp"], timeout: { execution: 5000 } },
          startup: {
            type: "local",
            command: ["startup-mcp"],
            timeout: { startup: 1000, catalog: 3000, execution: 3000 },
          },
        },
      },
    })

    expect(config.experimental?.mcp_timeout).toBe(8000)
    expect(config.mcp?.safe).toEqual({ type: "local", command: ["safe-mcp"], enabled: true, timeout: 3000 })
    expect(config.mcp?.unsafe).toEqual({ type: "local", command: ["unsafe-mcp"], enabled: true })
    expect(config.mcp?.partial).toEqual({ type: "local", command: ["partial-mcp"], enabled: true })
    expect(config.mcp?.startup).toEqual({ type: "local", command: ["startup-mcp"], enabled: true })
  })

  test("does not invent a global V1 timeout from startup or catalog phases", () => {
    const config = lower({ mcp: { timeout: { startup: 1000, catalog: 2000 } } })

    expect(config.experimental?.mcp_timeout).toBeUndefined()
    expect(config.mcp?.timeout).toBeUndefined()
  })

  test("lowers snapshots, media, compaction, and experimental subagent depth", () => {
    const config = lower({
      snapshots: false,
      media: {
        image: { auto_resize: false, max_width: 1920, max_height: 1080, max_base64_bytes: 4096 },
      },
      compaction: { auto: false, keep: { tokens: 12000 }, buffer: 2048 },
      experimental: { subagent_depth: 3 },
    })

    expect(config.snapshot).toBe(false)
    expect(config.attachment).toEqual({
      image: { auto_resize: false, max_width: 1920, max_height: 1080, max_base64_bytes: 4096 },
    })
    expect(config.compaction).toEqual({ auto: false, preserve_recent_tokens: 12000, reserved: 2048 })
    expect(config.subagent_depth).toBe(3)
  })

  test("keeps legacy scalar, media, compaction, and timeout settings over native equivalents", () => {
    const config = lower({
      snapshot: false,
      snapshots: true,
      attachment: { image: { max_width: 640 } },
      media: { image: { max_width: 1920 } },
      subagent_depth: 1,
      experimental: { subagent_depth: 3, mcp_timeout: 4000 },
      compaction: {
        preserve_recent_tokens: 100,
        keep: { tokens: 200 },
        reserved: 300,
        buffer: 400,
      },
      mcp: { timeout: { catalog: 8000, execution: 8000 } },
    })

    expect(config.snapshot).toBe(false)
    expect(config.attachment?.image?.max_width).toBe(640)
    expect(config.subagent_depth).toBe(1)
    expect(config.experimental?.mcp_timeout).toBe(4000)
    expect(config.compaction).toEqual({ preserve_recent_tokens: 100, reserved: 300 })
  })

  test("lowers object model selections and strips unsupported top-level variants", () => {
    expect(lower({ model: { providerID: "anthropic", model: "claude-sonnet", variant: "fast" } }).model).toBe(
      "anthropic/claude-sonnet",
    )
    expect(lower({ model: "anthropic/claude-sonnet#fast" }).model).toBe("anthropic/claude-sonnet")
    expect(lower({ model: "anthropic/claude-sonnet" }).model).toBe("anthropic/claude-sonnet")
  })

  test("separates skill URLs from filesystem paths", () => {
    const config = lower({
      skills: ["./skills", "https://example.com/skills", "/opt/skills", "http://localhost:8080/skills"],
    })

    expect(config.skills).toEqual({
      paths: ["./skills", "/opt/skills"],
      urls: ["https://example.com/skills", "http://localhost:8080/skills"],
    })
  })

  test("lowers ordered permission rules and renamed actions", () => {
    const config = lower({
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "shell", resource: "*", effect: "deny" },
        { action: "shell", resource: "git status", effect: "allow" },
        { action: "subagent", resource: "explore", effect: "allow" },
        { action: "question", resource: "*", effect: "ask" },
      ],
    })

    expect(config.permission).toEqual({
      "*": "deny",
      bash: { "*": "deny", "git status": "allow" },
      task: { explore: "allow" },
      question: "ask",
    })
  })

  test("retains final duplicate permission rules in their effective order", () => {
    const config = lower({
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "read", resource: "secret", effect: "deny" },
        { action: "read", resource: "*", effect: "deny" },
      ],
    })

    expect(config.permission).toEqual({ read: { secret: "deny", "*": "deny" } })
    expect(Object.keys(typeof config.permission?.read === "object" ? config.permission.read : {})).toEqual([
      "secret",
      "*",
    ])
  })

  test("combines legacy and native permissions with legacy rules last", () => {
    const config = lower({
      permission: { bash: "deny", edit: "deny" },
      permissions: [{ action: "shell", resource: "*", effect: "allow" }],
    })

    expect(config.permission).toEqual({ bash: "deny", edit: "deny" })
    expect(Object.keys(config.permission ?? {})).toEqual(["bash", "edit"])
    expect(
      lower({ permission: "deny", permissions: [{ action: "read", resource: "*", effect: "allow" }] }).permission,
    ).toEqual({ read: "allow", "*": "deny" })
  })

  test("rejects permission rules that would change action precedence", () => {
    expect(() =>
      lower({
        permissions: [
          { action: "read", resource: "*", effect: "allow" },
          { action: "*", resource: "*", effect: "deny" },
          { action: "read", resource: "public", effect: "allow" },
        ],
      }),
    ).toThrow("ConfigInvalidError")
  })

  test("rejects unsupported resource, action, and home-expansion permissions", () => {
    expect(() =>
      lower({ permissions: [{ action: "webfetch", resource: "https://internal.example/*", effect: "deny" }] }),
    ).toThrow("ConfigInvalidError")
    expect(() => lower({ permissions: [{ action: "sh*", resource: "*", effect: "deny" }] })).toThrow(
      "ConfigInvalidError",
    )
    expect(() => lower({ permissions: [{ action: "bash", resource: "*", effect: "deny" }] })).toThrow(
      "ConfigInvalidError",
    )
    expect(() => lower({ permissions: [{ action: "shell", resource: "$HOME/private/*", effect: "deny" }] })).toThrow(
      "ConfigInvalidError",
    )
  })

  test("rejects malformed native global and agent permission rules", () => {
    expect(() => lower({ permissions: "deny" })).toThrow("ConfigInvalidError")
    expect(() => lower({ permissions: [{ action: "read", resource: "*", effect: "permit" }] })).toThrow(
      "ConfigInvalidError",
    )
    expect(() => lower({ agents: { reviewer: { permissions: [{ action: "read" }] } } })).toThrow("ConfigInvalidError")
  })

  test("lowers agent selections, variants, system prompts, and disabled states", () => {
    const config = lower({
      agents: {
        reviewer: {
          model: { providerID: "anthropic", model: "claude-sonnet", variant: "thinking" },
          system: "Review carefully.",
          description: "Reviews changes",
          mode: "subagent",
          hidden: true,
          color: "#123abc",
          steps: 4,
          disabled: true,
          permissions: [
            { action: "read", resource: "*.ts", effect: "allow" },
            { action: "read", resource: "secret.ts", effect: "deny" },
          ],
        },
        quick: { model: "openai/gpt-4.1#fast", disabled: false },
      },
    })

    expect(config.agent?.reviewer).toMatchObject({
      model: "anthropic/claude-sonnet",
      variant: "thinking",
      prompt: "Review carefully.",
      description: "Reviews changes",
      mode: "subagent",
      hidden: true,
      color: "#123abc",
      steps: 4,
      disable: true,
    })
    expect(config.agent?.reviewer?.permission).toEqual({ read: { "*.ts": "allow", "secret.ts": "deny" } })
    expect(config.agent?.quick).toMatchObject({ model: "openai/gpt-4.1", variant: "fast", disable: false })
  })

  test("keeps legacy agent definitions and lowers separately named native agents", () => {
    const config = lower({
      agent: {
        reviewer: {
          prompt: "Legacy prompt",
          permission: { bash: "deny", edit: "deny" },
        },
      },
      agents: {
        reviewer: {
          system: "Native prompt",
          permissions: [{ action: "shell", resource: "*", effect: "allow" }],
        },
        native: {
          permissions: [{ action: "shell", resource: "*", effect: "deny" }],
        },
      },
    })

    expect(config.agent?.reviewer).toMatchObject({
      prompt: "Legacy prompt",
      permission: { bash: "deny", edit: "deny" },
    })
    expect(config.agent?.native?.permission).toEqual({ bash: "deny" })
  })

  test("keeps legacy commands when native commands use the same name", () => {
    const config = lower({
      command: { review: { template: "Legacy review" } },
      commands: {
        review: { template: "Native review" },
        modern: { template: "Native command" },
      },
    })

    expect(config.command).toEqual({
      review: { template: "Legacy review" },
      modern: { template: "Native command" },
    })
  })

  test("lowers command model selections and preserves their variants", () => {
    const config = lower({
      commands: {
        review: {
          template: "Review $ARGUMENTS",
          description: "Review code",
          agent: "reviewer",
          model: { providerID: "anthropic", model: "claude-sonnet", variant: "thinking" },
          subtask: true,
        },
        quick: { template: "Quick review", model: "openai/gpt-4.1#fast" },
      },
    })

    expect(config.command?.review).toEqual({
      template: "Review $ARGUMENTS",
      description: "Review code",
      agent: "reviewer",
      model: "anthropic/claude-sonnet",
      variant: "thinking",
      subtask: true,
    })
    expect(config.command?.quick).toEqual({ template: "Quick review", model: "openai/gpt-4.1", variant: "fast" })
  })

  test("filters custom LSP servers without extensions while retaining built-ins and disabled servers", () => {
    const config = lower({
      lsp: {
        typescript: { command: ["typescript-language-server", "--stdio"] },
        compatible: { command: ["custom-lsp"], extensions: [".custom"] },
        incompatible: { command: ["incompatible-lsp"] },
        disabled: { disabled: true },
      },
    })

    expect(config.lsp).toEqual({
      typescript: { command: ["typescript-language-server", "--stdio"] },
      compatible: { command: ["custom-lsp"], extensions: [".custom"] },
      disabled: { disabled: true },
    })
  })

  test("lowers native permission rules while ignoring unsupported plugins and providers", () => {
    const config = lower({
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
      plugins: [{ package: "@example/native-plugin" }],
      providers: { native: { models: { example: { name: "Native model" } } } },
      policies: [{ action: "provider.use", effect: "deny", resource: "openai" }],
    })

    expect(config.permission).toEqual({ read: "allow" })
    expect(config.plugin).toBeUndefined()
    expect(config.provider).toBeUndefined()
    expect(config.experimental?.policies).toBeUndefined()
  })

  test("preserves existing V1 policies when other V2 experimental fields are lowered", () => {
    const config = lower({
      experimental: {
        subagent_depth: 2,
        policies: [{ effect: "deny", action: "provider.use", resource: "openai" }],
        batch_tool: true,
      },
    })

    expect(config.subagent_depth).toBe(2)
    expect(config.experimental?.batch_tool).toBe(true)
    expect(config.experimental?.policies).toEqual([{ effect: "deny", action: "provider.use", resource: "openai" }])
  })

  test("does not sanitize malformed V1 fields before schema validation", () => {
    expect(() => lower({ model: 42 })).toThrow()
    expect(() => lower({ snapshot: "enabled" })).toThrow()
    expect(() => lower({ mcp: { broken: { type: "local", command: "not-an-array" } } })).toThrow()
    expect(() => lower({ experimental: { mcp_timeout: -1 } })).toThrow()
  })

  test("does not mutate the input or nested configuration objects", () => {
    const input = {
      model: { providerID: "anthropic", model: "claude-sonnet", variant: "fast" },
      snapshots: true,
      skills: ["./skills", "https://example.com/skills"],
      mcp: {
        existing: { type: "local", command: ["existing-mcp"], enabled: false },
        servers: {
          native: {
            type: "remote",
            url: "https://example.com/mcp",
            disabled: true,
            oauth: { client_id: "client" },
            timeout: { execution: 3000 },
          },
        },
      },
      agents: { reviewer: { model: "anthropic/claude-sonnet#thinking", disabled: true } },
      experimental: { subagent_depth: 2 },
    }
    const original = structuredClone(input)

    lower(input)

    expect(input).toEqual(original)
  })
})

describe("V2 configuration loading", () => {
  it.instance("logs compatibility diagnostics without writing the lowered projection", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const fs = yield* FSUtil.Service
      const file = path.join(instance.directory, "opencode.jsonc")
      const text =
        '{\n  // Retain this comment\n  "$schema": "https://opencode.ai/config.json",\n  "plugins": ["native-only"]\n}\n'
      yield* fs.writeWithDirs(file, text)
      const messages: unknown[] = []
      const config = yield* Config.use.get().pipe(
        Effect.provide(
          Logger.layer([
            Logger.make<unknown, void>((options) => {
              messages.push(options.message)
            }),
          ]),
        ),
      )

      expect(config.plugin).toEqual([])
      expect(messages).toContainEqual([
        "configuration compatibility diagnostic",
        expect.objectContaining({ source: file, kind: "unsupported", path: ["plugins"] }),
      ])
      expect(yield* fs.readFileString(file)).toBe(text)
    }),
  )

  it.instance("loads native V2 configuration through the V1 Config service", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(
        path.join(instance.directory, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: { providerID: "anthropic", model: "claude-sonnet", variant: "fast" },
          snapshots: false,
          skills: ["./skills", "https://example.com/skills"],
          mcp: {
            timeout: { catalog: 9000, execution: 9000 },
            servers: {
              native: { type: "remote", url: "https://native.example.com/mcp", disabled: false },
            },
          },
          permissions: [
            { action: "shell", resource: "*", effect: "deny" },
            { action: "shell", resource: "git status", effect: "allow" },
          ],
          agents: {
            reviewer: {
              model: "anthropic/claude-sonnet#thinking",
              system: "Review carefully.",
              permissions: [{ action: "subagent", resource: "explore", effect: "deny" }],
            },
          },
          commands: {
            review: {
              template: "Review $ARGUMENTS",
              model: { providerID: "anthropic", model: "claude-sonnet", variant: "thinking" },
            },
          },
          experimental: { subagent_depth: 2 },
        }),
      )

      const config = yield* Config.use.get()

      expect(config.model).toBe("anthropic/claude-sonnet")
      expect(config.snapshot).toBe(false)
      expect(config.skills).toEqual({ paths: ["./skills"], urls: ["https://example.com/skills"] })
      expect(config.mcp?.native).toEqual({ type: "remote", url: "https://native.example.com/mcp", enabled: true })
      expect(config.experimental?.mcp_timeout).toBe(9000)
      expect(config.permission).toMatchObject({ bash: { "*": "deny", "git status": "allow" } })
      expect(config.agent?.reviewer).toMatchObject({
        model: "anthropic/claude-sonnet",
        variant: "thinking",
        prompt: "Review carefully.",
        permission: { task: { explore: "deny" } },
      })
      expect(config.command?.review).toMatchObject({
        template: "Review $ARGUMENTS",
        model: "anthropic/claude-sonnet",
        variant: "thinking",
      })
      expect(config.subagent_depth).toBe(2)
    }),
  )

  it.instance("keeps legacy TUI normalization when loading a mixed V1 and V2 document", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(
        path.join(instance.directory, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: { providerID: "openai", model: "gpt-4.1" },
          theme: "legacy",
          keybinds: { leader: "ctrl+x" },
          tui: { scroll_speed: 4 },
          mcp: {
            legacy: { enabled: false },
            servers: { native: { type: "local", command: ["native-mcp"] } },
          },
        }),
      )

      const config = yield* Config.use.get()

      expect(config.model).toBe("openai/gpt-4.1")
      expect(config.mcp?.legacy).toEqual({ enabled: false })
      expect(config.mcp?.native).toEqual({ type: "local", command: ["native-mcp"], enabled: true })
      expect(config).not.toHaveProperty("theme")
      expect(config).not.toHaveProperty("keybinds")
      expect(config).not.toHaveProperty("tui")
    }),
  )
})
