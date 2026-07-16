import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, PubSub, Schema, Stream } from "effect"
import { FastCheck } from "effect/testing"
import { Config } from "@opencode-ai/core/config"
import { ConfigModel } from "@opencode-ai/core/config/model"
import { Config as ConfigSchema } from "@opencode-ai/schema/config"
import { ConfigProvider } from "@opencode-ai/core/config/provider"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Credential } from "@opencode-ai/core/credential"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WellKnown } from "@opencode-ai/core/wellknown"
import { Integration } from "@opencode-ai/schema/integration"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const selection = Schema.decodeUnknownSync(ConfigModel.Selection)

const emptyCredentialNode = makeGlobalNode({
  service: Credential.Service,
  layer: Layer.succeed(
    Credential.Service,
    Credential.Service.of({
      all: () => Effect.succeed([]),
      list: () => Effect.succeed([]),
      get: () => Effect.succeed(undefined),
      create: () => Effect.die("unused Credential.create"),
      update: () => Effect.die("unused Credential.update"),
      remove: () => Effect.die("unused Credential.remove"),
    }),
  ),
  deps: [],
})

const emptyWellknownNode = makeGlobalNode({
  service: WellKnown.Service,
  layer: Layer.succeed(
    WellKnown.Service,
    WellKnown.Service.of({
      entries: () => Effect.succeed([]),
      snapshot: () => [],
      refresh: () => Effect.succeed(false),
      add: () => Effect.die("unused Wellknown.add"),
      remove: () => Effect.die("unused Wellknown.remove"),
      resolve: () => Effect.die("unused Wellknown.resolve"),
    }),
  ),
  deps: [],
})

function testLayer(
  directory: string,
  globalDirectory = path.join(directory, "global"),
  projectDirectory = directory,
  vcs?: Project.Vcs,
  watcher?: Layer.Layer<Watcher.Service>,
  credentialNode = emptyCredentialNode,
  wellknownNode = emptyWellknownNode,
) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location(
        { directory: AbsolutePath.make(directory) },
        { projectDirectory: AbsolutePath.make(projectDirectory), vcs },
      ),
    ),
  )
  return AppNodeBuilder.build(LayerNode.group([Config.node, EventV2.node]), [
    [Location.node, locationLayer],
    [Global.node, Global.layerWith({ config: globalDirectory, home: path.join(globalDirectory, "home") })],
    [Credential.node, credentialNode],
    [WellKnown.node, wellknownNode],
    ...(watcher ? ([[Watcher.node, watcher]] as const) : []),
  ])
}

const provider = {
  package: "native",
  settings: {},
  headers: {},
  body: {},
  models: {},
}

describe("Config", () => {
  it.live("reloads external config and publishes directory updates", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, "project")
          const file = path.join(global, "opencode.json")
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(project, { recursive: true })
            await fs.writeFile(file, JSON.stringify({ shell: "first" }))
          })
          const updates = yield* PubSub.unbounded<Watcher.Update>()
          const watcher = Layer.succeed(
            Watcher.Service,
            Watcher.Service.of({
              subscribe: () => Stream.fromPubSub(updates),
            }),
          )

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const events = yield* EventV2.Service
            const changed = yield* events
              .subscribe(ConfigSchema.Event.Updated)
              .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
            yield* Effect.sleep("10 millis")

            yield* PubSub.publish(updates, {
              type: "update",
              path: path.join(global, "commands", "review.md"),
            } satisfies Watcher.Update)
            yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ shell: "second" })))
            yield* PubSub.publish(updates, { type: "update", path: file } satisfies Watcher.Update)

            expect(yield* Fiber.join(changed)).toHaveLength(1)
            expect(Config.latest(yield* config.entries(), "shell")).toBe("second")
          }).pipe(Effect.provide(testLayer(project, global, project, undefined, watcher)))
        }),
      ),
    ),
  )

  it.effect("returns the latest defined scalar from priority-ordered documents", () =>
    Effect.sync(() => {
      const entries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({ model: selection("openrouter/openai/gpt-5") }),
        }),
        new Config.Directory({ type: "directory", path: AbsolutePath.make("/skills") }),
        new Config.AgentsDirectory({ type: "agents", path: AbsolutePath.make("/agents") }),
        new Config.Document({ type: "document", info: new Config.Info({}) }),
        new Config.Document({
          type: "document",
          info: new Config.Info({ model: selection("openrouter/openai/gpt-5.5") }),
        }),
      ]

      expect(Config.latest(entries, "model")).toEqual(selection("openrouter/openai/gpt-5.5"))
      expect(Config.latest(entries, "default_agent")).toBeUndefined()
    }),
  )

  it.live("loads authenticated wellknown config at highest priority", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(project, { recursive: true })
            await fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ shell: "global" }))
            await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ shell: "project" }))
          })

          const integrationID = Integration.ID.make("https://example.com")
          let key = "secret"
          const credentialNode = makeGlobalNode({
            service: Credential.Service,
            layer: Layer.succeed(
              Credential.Service,
              Credential.Service.of({
                all: () => Effect.die("unused Credential.all"),
                list: () =>
                  Effect.succeed([
                    new Credential.Info({
                      id: Credential.ID.create(),
                      integrationID,
                      label: "default",
                      value: Credential.Key.make({ type: "key", key }),
                    }),
                  ]),
                get: () => Effect.die("unused Credential.get"),
                create: () => Effect.die("unused Credential.create"),
                update: () => Effect.die("unused Credential.update"),
                remove: () => Effect.die("unused Credential.remove"),
              }),
            ),
            deps: [],
          })
          const entry: WellKnown.Entry = {
            origin: "https://example.com",
            integrationID,
            manifest: { auth: { command: ["login"], env: "TOKEN" } },
          }
          const wellknownNode = makeGlobalNode({
            service: WellKnown.Service,
            layer: Layer.succeed(
              WellKnown.Service,
              WellKnown.Service.of({
                entries: () => Effect.succeed([entry]),
                snapshot: () => [entry],
                refresh: () => Effect.succeed(false),
                add: () => Effect.die("unused Wellknown.add"),
                remove: () => Effect.die("unused Wellknown.remove"),
                resolve: (_entry, variables) => Effect.succeed([{ shell: variables.TOKEN }]),
              }),
            ),
            deps: [],
          })

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const events = yield* EventV2.Service
            expect(Config.latest(yield* config.entries(), "shell")).toBe("secret")
            const updated = yield* events
              .subscribe(ConfigSchema.Event.Updated)
              .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
            yield* Effect.yieldNow
            key = "next"
            yield* events.publish(Integration.Event.ConnectionUpdated, { integrationID })
            expect(yield* Fiber.join(updated)).toHaveLength(1)
            expect(Config.latest(yield* config.entries(), "shell")).toBe("next")
          }).pipe(
            Effect.provide(testLayer(project, global, project, undefined, undefined, credentialNode, wellknownNode)),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("detects v1 configuration from any v1-only top-level key", () =>
    Effect.sync(() => {
      expect(ConfigMigrateV1.isV1({ snapshot: false })).toBe(true)
      expect(ConfigMigrateV1.isV1({ snapshot: false, agents: {} })).toBe(true)
      expect(ConfigMigrateV1.isV1({ reference: {} })).toBe(true)
      expect(ConfigMigrateV1.isV1({ shell: "/bin/zsh", model: "anthropic/claude" })).toBe(false)
      expect(ConfigMigrateV1.isV1({ references: {} })).toBe(false)
    }),
  )

  it.effect("detects a bare v1-shaped mcp block while leaving v2 mcp config alone", () =>
    Effect.sync(() => {
      // V1 lists servers directly under `mcp`, so a file with only `$schema` + `mcp` still migrates.
      expect(ConfigMigrateV1.isV1({ mcp: { context7: { type: "local", command: ["npx"] } } })).toBe(true)
      expect(ConfigMigrateV1.isV1({ $schema: "x", mcp: { executor: { type: "remote", url: "https://x" } } })).toBe(true)
      // V2 nests under `mcp.servers`, so it must not be misdetected and re-migrated.
      expect(ConfigMigrateV1.isV1({ mcp: { servers: { context7: { type: "local", command: ["npx"] } } } })).toBe(false)
      expect(ConfigMigrateV1.isV1({ mcp: {} })).toBe(false)
      expect(ConfigMigrateV1.isV1({ mcp: { timeout: { execution: 1000 } } })).toBe(false)
    }),
  )

  it.effect("migrates arbitrary v1 configuration into valid v2 configuration", () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(Schema.toArbitrary(ConfigV1.Info), (info) => {
          const parsed = Schema.decodeUnknownSync(ConfigV1.Info)(
            Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(
              Schema.encodeUnknownSync(Schema.UnknownFromJsonString)(info),
            ),
          )
          Schema.decodeUnknownSync(Config.Info)(ConfigMigrateV1.migrate(parsed), { errors: "all" })
        }),
        { numRuns: 100 },
      )
    }),
  )

  it.effect("migrates the v1 experimental subagent depth", () =>
    Effect.sync(() => {
      expect(ConfigMigrateV1.migrate({ experimental: { subagent_depth: 2 } }).experimental?.subagent_depth).toBe(2)
    }),
  )

  it.effect("migrates v1 provider lists to policies", () =>
    Effect.sync(() => {
      expect(
        ConfigMigrateV1.migrate({
          enabled_providers: ["anthropic", "openai"],
          disabled_providers: ["openai"],
        }).experimental?.policies,
      ).toEqual([
        { action: "provider.use", resource: "*", effect: "deny" },
        { action: "provider.use", resource: "anthropic", effect: "allow" },
        { action: "provider.use", resource: "openai", effect: "allow" },
        { action: "provider.use", resource: "openai", effect: "deny" },
      ])
      expect(ConfigMigrateV1.migrate({ enabled_providers: [] }).experimental?.policies).toEqual([
        { action: "provider.use", resource: "*", effect: "deny" },
      ])
    }),
  )

  it.effect("migrates v1 provider setup options into AISDK settings", () =>
    Effect.sync(() => {
      const migrated = ConfigMigrateV1.migrate({
        provider: {
          bedrock: {
            npm: "@ai-sdk/amazon-bedrock",
            options: {
              headers: { "x-test": "1" },
              body: { trace: true },
              region: "us-east-1",
              profile: "dev",
            },
          },
        },
      })

      expect(migrated.providers?.bedrock).toMatchObject({
        package: ProviderV2.aisdk("@ai-sdk/amazon-bedrock"),
        settings: { region: "us-east-1", profile: "dev" },
        headers: { "x-test": "1" },
        body: { trace: true },
      })
    }),
  )

  it.effect("migrates v1 command configuration", () =>
    Effect.sync(() => {
      expect(
        ConfigMigrateV1.migrate({
          command: {
            review: {
              template: "Review changes",
              description: "Review code",
              agent: "reviewer",
              model: "anthropic/claude",
              variant: "high",
              subtask: true,
            },
          },
        }).commands,
      ).toEqual({
        review: {
          template: "Review changes",
          description: "Review code",
          agent: "reviewer",
          model: { providerID: "anthropic", model: "claude", variant: "high" },
          subtask: true,
        },
      })
    }),
  )

  it.effect("normalizes renamed permission actions when migrating v1 permissions", () =>
    Effect.sync(() => {
      expect(
        ConfigMigrateV1.migrate({
          permission: {
            task: "ask",
            bash: { "git status": "allow", "*": "deny" },
            write: "deny",
            read: "allow",
          },
        }).permissions,
      ).toEqual([
        { action: "subagent", resource: "*", effect: "ask" },
        { action: "shell", resource: "git status", effect: "allow" },
        { action: "shell", resource: "*", effect: "deny" },
        { action: "edit", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ])
    }),
  )

  it.live("returns an empty configuration when directory files do not exist", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const config = yield* Config.Service
          const entries = yield* config.entries()

          expect(entries).toEqual([
            new Config.Directory({ type: "directory", path: AbsolutePath.make(path.join(tmp.path, "global")) }),
          ])
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )

  it.live("does not watch ecosystem config roots", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              fs.mkdir(path.join(tmp.path, ".claude", "skills"), { recursive: true }),
              fs.mkdir(path.join(tmp.path, ".agents"), { recursive: true }),
            ]),
          )
          const targets: Watcher.WatchInput[] = []
          const watcher = Layer.succeed(
            Watcher.Service,
            Watcher.Service.of({
              subscribe: (input) => {
                targets.push(input)
                return Stream.never
              },
            }),
          )

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            yield* config.entries()

            expect(targets).toEqual([{ type: "directory", path: AbsolutePath.make(path.join(tmp.path, "global")) }])
          }).pipe(Effect.provide(testLayer(tmp.path, undefined, undefined, undefined, watcher)))
        }),
      ),
    ),
  )

  it.live("loads opencode JSON and JSONC files from lowest to highest priority", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(
                path.join(tmp.path, "opencode.json"),
                JSON.stringify({ $schema: "base", providers: { base: provider } }),
              ),
              fs.writeFile(
                path.join(tmp.path, "opencode.jsonc"),
                `{
                  // Later global files override scalar fields while retaining providers.
                  "$schema": "last",
                  "providers": { "last": ${JSON.stringify(provider)} },
                }`,
              ),
            ]),
          )
          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = (yield* config.entries()).filter((entry) => entry.type === "document")

            expect(documents).toHaveLength(2)
            expect(documents.map((document) => document.type)).toEqual(["document", "document"])
            expect(documents.map((document) => document.info.$schema)).toEqual(["base", "last"])
            expect(documents[0]).toBeInstanceOf(Config.Document)
            expect(documents[0]?.path).toBe(path.join(tmp.path, "opencode.json"))
            expect(documents[1]?.info.providers?.last).toBeInstanceOf(ConfigProvider.Info)

            yield* Effect.promise(() =>
              fs.writeFile(path.join(tmp.path, "opencode.jsonc"), JSON.stringify({ $schema: "changed" })),
            )
            expect(
              (yield* config.entries())
                .filter((entry) => entry.type === "document")
                .map((document) => document.info.$schema),
            ).toEqual(["base", "last"])
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )

  it.live("substitutes environment variables and relative file contents", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          token: process.env.OPENCODE_TEST_MCP_TOKEN,
          missing: process.env.OPENCODE_TEST_MISSING,
        }
        process.env.OPENCODE_TEST_MCP_TOKEN = "secret"
        delete process.env.OPENCODE_TEST_MISSING
        return previous
      }),
      () =>
        Effect.acquireUseRelease(
          Effect.promise(() => tmpdir()),
          (tmp) =>
            Effect.gen(function* () {
              yield* Effect.promise(() =>
                Promise.all([
                  fs.writeFile(path.join(tmp.path, "token.txt"), 'file\n"token"\n'),
                  fs.writeFile(
                    path.join(tmp.path, "opencode.jsonc"),
                    `{
                      // Ignored reference: {file:missing.txt}
                      "username": "user-{env:OPENCODE_TEST_MISSING}",
                      "mcp": {
                        "servers": {
                          "remote": {
                            "type": "remote",
                            "url": "https://example.com/mcp",
                            "headers": {
                              "Authorization": "Bearer {env:OPENCODE_TEST_MCP_TOKEN}",
                              "X-Token": "{file:token.txt}"
                            }
                          }
                        }
                      }
                    }`,
                  ),
                ]),
              )

              return yield* Effect.gen(function* () {
                const config = yield* Config.Service
                const document = (yield* config.entries()).find((entry) => entry.type === "document")
                expect(document?.info.username).toBe("user-")
                const remote = document?.info.mcp?.servers?.remote
                expect(remote?.type).toBe("remote")
                if (remote?.type !== "remote") return
                expect(remote.headers).toEqual({
                  Authorization: "Bearer secret",
                  "X-Token": 'file\n"token"',
                })
              }).pipe(Effect.provide(testLayer(tmp.path)))
            }),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        ),
      (previous) =>
        Effect.sync(() => {
          if (previous.token === undefined) delete process.env.OPENCODE_TEST_MCP_TOKEN
          else process.env.OPENCODE_TEST_MCP_TOKEN = previous.token
          if (previous.missing === undefined) delete process.env.OPENCODE_TEST_MISSING
          else process.env.OPENCODE_TEST_MISSING = previous.missing
        }),
    ),
  )

  it.live("does not load legacy config.json files", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(path.join(tmp.path, "config.json"), JSON.stringify({ $schema: "legacy" })),
          )

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = (yield* config.entries()).filter((entry) => entry.type === "document")

            expect(documents).toHaveLength(0)
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )

  it.live("accepts $schema metadata without writing it into config files", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "opencode.json")
          const contents = JSON.stringify({
            shell: "/bin/zsh",
            providers: { local: provider },
          })
          yield* Effect.promise(() => fs.writeFile(file, contents))

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = (yield* config.entries()).filter((entry) => entry.type === "document")

            expect(documents[0]?.info.$schema).toBeUndefined()
            expect(documents[0]?.info.shell).toBe("/bin/zsh")
            expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(contents)
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )

  it.live("loads supported scalar and resource configuration", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(tmp.path, "opencode.json"),
              JSON.stringify({
                shell: "/bin/bash",
                model: "anthropic/claude",
                default_agent: "reviewer",
                autoupdate: "notify",
                share: "disabled",
                enterprise: { url: "https://share.example.com" },
                username: "test-user",
                permissions: [
                  { action: "bash", resource: "*", effect: "ask" },
                  { action: "bash", resource: "git status", effect: "allow" },
                ],
                agents: {
                  reviewer: {
                    model: "openrouter/openai/gpt-5#high",
                    request: {
                      headers: { "x-agent": "reviewer" },
                      body: { reasoningEffort: "high" },
                    },
                    description: "Review changes for correctness",
                    system: "Find regressions.",
                    mode: "subagent",
                    hidden: false,
                    color: "warning",
                    steps: 12,
                    disabled: false,
                    permissions: [{ action: "edit", resource: "*", effect: "deny" }],
                  },
                },
                snapshots: false,
                watcher: { ignore: ["node_modules/**", "dist/**", ".git"] },
                formatter: {
                  prettier: { disabled: true },
                  custom: { command: ["custom-fmt", "$FILE"], extensions: [".foo"] },
                },
                lsp: { typescript: { disabled: true }, custom: { command: ["custom-lsp"], extensions: [".foo"] } },
                attachments: {
                  image: { auto_resize: false, max_width: 1200, max_height: 900, max_base64_bytes: 1048576 },
                },
                tool_output: { max_lines: 1000, max_bytes: 32768 },
                mcp: {
                  timeout: { startup: 5000, catalog: 60000, execution: 43200000 },
                  servers: {
                    local: {
                      type: "local",
                      command: ["node", "./mcp/server.js"],
                      environment: { API_KEY: "secret" },
                      disabled: false,
                      timeout: { catalog: 10000 },
                    },
                    remote: {
                      type: "remote",
                      url: "https://mcp.example.com/mcp",
                      headers: { Authorization: "Bearer token" },
                      oauth: { client_id: "client", scope: "read write", callback_port: 19876 },
                      disabled: true,
                      timeout: { startup: 15000 },
                    },
                  },
                },
                compaction: {
                  auto: true,
                  prune: false,
                  keep: { tokens: 2000 },
                  buffer: 10000,
                },
                skills: ["./skills", "~/shared-skills", "https://example.com/.well-known/skills/"],
                instructions: ["CONTRIBUTING.md", ".cursor/rules/*.md", "https://example.com/shared-rules.md"],
                references: {
                  local: { path: "../library" },
                  sdk: { repository: "github.com/example/sdk", branch: "main" },
                  shorthand: "github.com/example/docs",
                },
                plugins: [
                  "opencode-helicone-session",
                  { package: "@my-org/audit-plugin", options: { endpoint: "https://audit.example.com" } },
                ],
              }),
            ),
          )

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = (yield* config.entries()).filter((entry) => entry.type === "document")

            expect(documents).toHaveLength(1)
            expect(documents[0]?.info.shell).toBe("/bin/bash")
            expect(documents[0]?.info.model).toEqual(selection("anthropic/claude"))
            expect(documents[0]?.info.default_agent).toBe("reviewer")
            expect(documents[0]?.info.autoupdate).toBe("notify")
            expect(documents[0]?.info.share).toBe("disabled")
            expect(documents[0]?.info.enterprise).toEqual({ url: "https://share.example.com" })
            expect(documents[0]?.info.username).toBe("test-user")
            expect(documents[0]?.info.permissions).toEqual([
              { action: "bash", resource: "*", effect: "ask" },
              { action: "bash", resource: "git status", effect: "allow" },
            ])
            const reviewer = documents[0]?.info.agents?.reviewer
            expect(reviewer?.model).toEqual(selection("openrouter/openai/gpt-5#high"))
            expect(reviewer?.request).toEqual({
              headers: { "x-agent": "reviewer" },
              body: { reasoningEffort: "high" },
            })
            expect(reviewer?.description).toBe("Review changes for correctness")
            expect(reviewer?.system).toBe("Find regressions.")
            expect(reviewer?.mode).toBe("subagent")
            expect(reviewer?.hidden).toBe(false)
            expect(reviewer?.color).toBe("warning")
            expect(reviewer?.steps).toBe(12)
            expect(reviewer?.disabled).toBe(false)
            expect(reviewer?.permissions).toEqual([{ action: "edit", resource: "*", effect: "deny" }])
            expect(documents[0]?.info.snapshots).toBe(false)
            expect(documents[0]?.info.watcher).toEqual({ ignore: ["node_modules/**", "dist/**", ".git"] })
            expect(documents[0]?.info.formatter).toEqual({
              prettier: { disabled: true },
              custom: { command: ["custom-fmt", "$FILE"], extensions: [".foo"] },
            })
            expect(documents[0]?.info.lsp).toEqual({
              typescript: { disabled: true },
              custom: { command: ["custom-lsp"], extensions: [".foo"] },
            })
            expect(documents[0]?.info.attachments).toEqual({
              image: { auto_resize: false, max_width: 1200, max_height: 900, max_base64_bytes: 1048576 },
            })
            expect(documents[0]?.info.tool_output).toEqual({ max_lines: 1000, max_bytes: 32768 })
            expect(documents[0]?.info.mcp).toEqual({
              timeout: { startup: 5000, catalog: 60000, execution: 43200000 },
              servers: {
                local: {
                  type: "local",
                  command: ["node", "./mcp/server.js"],
                  environment: { API_KEY: "secret" },
                  disabled: false,
                  timeout: { catalog: 10000 },
                },
                remote: {
                  type: "remote",
                  url: "https://mcp.example.com/mcp",
                  headers: { Authorization: "Bearer token" },
                  oauth: { client_id: "client", scope: "read write", callback_port: 19876 },
                  disabled: true,
                  timeout: { startup: 15000 },
                },
              },
            })
            expect(documents[0]?.info.compaction).toEqual({
              auto: true,
              prune: false,
              keep: { tokens: 2000 },
              buffer: 10000,
            })
            expect(documents[0]?.info.skills).toEqual([
              "./skills",
              "~/shared-skills",
              "https://example.com/.well-known/skills/",
            ])
            expect(documents[0]?.info.instructions).toEqual([
              "CONTRIBUTING.md",
              ".cursor/rules/*.md",
              "https://example.com/shared-rules.md",
            ])
            expect(documents[0]?.info.references).toEqual({
              local: { path: "../library" },
              sdk: { repository: "github.com/example/sdk", branch: "main" },
              shorthand: "github.com/example/docs",
            })
            expect(documents[0]?.info.plugins).toEqual([
              "opencode-helicone-session",
              { package: "@my-org/audit-plugin", options: { endpoint: "https://audit.example.com" } },
            ])
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )

  it.live("migrates the deprecated reference key into references", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(tmp.path, "opencode.json"),
              JSON.stringify({
                reference: {
                  local: { path: "../library" },
                  sdk: { repository: "github.com/example/sdk", branch: "main" },
                  shorthand: "github.com/example/docs",
                },
              }),
            ),
          )

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = (yield* config.entries()).filter((entry) => entry.type === "document")

            expect(documents).toHaveLength(1)
            expect(documents[0]?.info.references).toEqual({
              local: { path: "../library" },
              sdk: { repository: "github.com/example/sdk", branch: "main" },
              shorthand: "github.com/example/docs",
            })
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )

  it.live("migrates v1 configuration when a v1-only key is present", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(tmp.path, "opencode.json"),
              JSON.stringify({
                shell: "/bin/zsh",
                default_agent: "reviewer",
                snapshot: false,
                autoshare: true,
                permission: {
                  bash: "ask",
                  edit: { "*.md": "allow", "*": "deny" },
                  question: "deny",
                },
                agent: {
                  reviewer: {
                    prompt: "Review changes.",
                    disable: true,
                    temperature: 0.2,
                    permission: { read: "allow" },
                  },
                },
                plugin: [
                  "opencode-helicone-session",
                  ["@my-org/audit-plugin", { endpoint: "https://audit.example.com" }],
                ],
                skills: { paths: ["./skills"], urls: ["https://example.com/.well-known/skills/"] },
                references: {
                  docs: { path: "../docs", description: "Use for product documentation", hidden: true },
                },
                attachment: { image: { auto_resize: false, max_width: 1200 } },
                provider: {
                  custom: {
                    options: { apiKey: "secret" },
                    models: {
                      model: {
                        options: { reasoningEffort: "high" },
                        variants: { fast: { temperature: 0.2 } },
                      },
                    },
                  },
                  openai: {
                    npm: "@ai-sdk/openai",
                    options: { apiKey: "secret", organization: "org" },
                    models: {
                      model: {
                        options: { temperature: 0.3, reasoningEffort: "high", serviceTier: "priority" },
                        variants: { high: { reasoningEffort: "high", reasoningSummary: "auto" } },
                      },
                    },
                  },
                  anthropic: {
                    npm: "@ai-sdk/anthropic",
                    models: {
                      model: {
                        options: {
                          effort: "high",
                          taskBudget: 4096,
                          metadata: { userId: "user-1" },
                        },
                      },
                    },
                  },
                },
                compaction: { auto: true, tail_turns: 3, preserve_recent_tokens: 2000, reserved: 10000 },
                experimental: { mcp_timeout: 5000 },
                mcp: {
                  local: { type: "local", command: ["node", "server.js"], enabled: false, timeout: 10000 },
                  remote: {
                    type: "remote",
                    url: "https://mcp.example.com",
                    oauth: { clientId: "client", callbackPort: 19876 },
                    timeout: 20000,
                  },
                },
              }),
            ),
          )

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = (yield* config.entries()).filter((entry) => entry.type === "document")

            expect(documents).toHaveLength(1)
            expect(documents[0]?.info).toBeInstanceOf(Config.Info)
            expect(documents[0]?.info.shell).toBe("/bin/zsh")
            expect(documents[0]?.info.default_agent).toBe("reviewer")
            expect(documents[0]?.info.snapshots).toBe(false)
            expect(documents[0]?.info.share).toBe("auto")
            expect(documents[0]?.info.permissions).toEqual([
              { action: "shell", resource: "*", effect: "ask" },
              { action: "edit", resource: "*.md", effect: "allow" },
              { action: "edit", resource: "*", effect: "deny" },
              { action: "question", resource: "*", effect: "deny" },
            ])
            expect(documents[0]?.info.agents?.reviewer).toMatchObject({
              system: "Review changes.",
              disabled: true,
              request: { body: { temperature: 0.2 } },
              permissions: [{ action: "read", resource: "*", effect: "allow" }],
            })
            expect(documents[0]?.info.plugins).toEqual([
              "opencode-helicone-session",
              { package: "@my-org/audit-plugin", options: { endpoint: "https://audit.example.com" } },
            ])
            expect(documents[0]?.info.skills).toEqual(["./skills", "https://example.com/.well-known/skills/"])
            expect(documents[0]?.info.references).toEqual({
              docs: { path: "../docs", description: "Use for product documentation", hidden: true },
            })
            expect(documents[0]?.info.attachments).toEqual({ image: { auto_resize: false, max_width: 1200 } })
            expect(documents[0]?.info.providers?.custom).toMatchObject({
              settings: { apiKey: "secret" },
              models: {
                model: {
                  settings: { reasoningEffort: "high" },
                  variants: [{ id: "fast", settings: { temperature: 0.2 } }],
                },
              },
            })
            expect(documents[0]?.info.providers?.openai).toMatchObject({
              package: ProviderV2.aisdk("@ai-sdk/openai"),
              settings: { apiKey: "secret", organization: "org" },
              models: {
                model: {
                  settings: { temperature: 0.3, reasoningEffort: "high", serviceTier: "priority" },
                  variants: [{ id: "high", settings: { reasoningEffort: "high", reasoningSummary: "auto" } }],
                },
              },
            })
            expect(documents[0]?.info.providers?.anthropic).toMatchObject({
              package: ProviderV2.aisdk("@ai-sdk/anthropic"),
              models: {
                model: {
                  settings: {
                    effort: "high",
                    taskBudget: 4096,
                    metadata: { userId: "user-1" },
                  },
                },
              },
            })
            expect(documents[0]?.info.compaction).toEqual({
              auto: true,
              prune: undefined,
              keep: { tokens: 2000 },
              buffer: 10000,
            })
            expect(documents[0]?.info.mcp).toMatchObject({
              timeout: { catalog: 5000, execution: 5000 },
              servers: {
                local: {
                  type: "local",
                  command: ["node", "server.js"],
                  disabled: true,
                  timeout: { catalog: 10000, execution: 10000 },
                },
                remote: {
                  type: "remote",
                  url: "https://mcp.example.com",
                  oauth: { client_id: "client", callback_port: 19876 },
                  timeout: { catalog: 20000, execution: 20000 },
                },
              },
            })
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )

  it.live("ignores an invalid file while loading valid config values", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({ $schema: "base" })),
              fs.writeFile(path.join(tmp.path, "opencode.jsonc"), "{ invalid"),
            ]),
          )
          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = (yield* config.entries()).filter((entry) => entry.type === "document")

            expect(documents.map((document) => document.info.$schema)).toEqual(["base"])
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )

  it.live("loads global and ancestor configuration across the project boundary", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const global = path.join(tmp.path, "global")
        const root = path.join(tmp.path, "repo")
        const parent = path.join(root, "packages")
        const directory = path.join(parent, "app")
        const globalAgents = path.join(global, "home", ".agents")
        const globalClaude = path.join(global, "home", ".claude")
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(globalAgents, { recursive: true })
            await fs.mkdir(globalClaude, { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.mkdir(path.join(root, ".agents"), { recursive: true })
            await fs.mkdir(path.join(root, ".claude"), { recursive: true })
            await fs.mkdir(path.join(root, ".opencode"), { recursive: true })
            await fs.mkdir(path.join(directory, ".agents"), { recursive: true })
            await fs.mkdir(path.join(directory, ".claude"), { recursive: true })
            await fs.mkdir(path.join(directory, ".opencode"), { recursive: true })
            await Promise.all([
              fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({ $schema: "outside" })),
              fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ $schema: "global" })),
              fs.writeFile(path.join(root, "opencode.json"), JSON.stringify({ $schema: "root" })),
              fs.writeFile(path.join(parent, "opencode.jsonc"), JSON.stringify({ $schema: "parent" })),
              fs.writeFile(path.join(directory, "opencode.json"), JSON.stringify({ $schema: "directory" })),
              fs.writeFile(path.join(root, ".opencode", "opencode.json"), JSON.stringify({ $schema: "root-dot" })),
              fs.writeFile(
                path.join(directory, ".opencode", "opencode.jsonc"),
                JSON.stringify({ $schema: "directory-dot" }),
              ),
            ])
          })

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const entries = yield* config.entries()
            const documents = entries.filter((entry) => entry.type === "document")

            expect(entries.filter((entry) => entry.type === "directory").map((entry) => entry.path)).toEqual([
              AbsolutePath.make(global),
              AbsolutePath.make(path.join(root, ".opencode")),
              AbsolutePath.make(path.join(directory, ".opencode")),
            ])
            expect(entries.filter((entry) => entry.type === "agents").map((entry) => entry.path)).toEqual([
              AbsolutePath.make(globalAgents),
              AbsolutePath.make(path.join(directory, ".agents")),
              AbsolutePath.make(path.join(root, ".agents")),
            ])
            expect(entries.filter((entry) => entry.type === "claude").map((entry) => entry.path)).toEqual([
              AbsolutePath.make(globalClaude),
              AbsolutePath.make(path.join(directory, ".claude")),
              AbsolutePath.make(path.join(root, ".claude")),
            ])
            expect(documents.map((document) => document.info.$schema)).toEqual([
              "global",
              "outside",
              "root",
              "parent",
              "directory",
              "root-dot",
              "directory-dot",
            ])
            expect(entries.map((entry) => (entry.type === "document" ? entry.info.$schema : entry.path))).toEqual([
              AbsolutePath.make(globalClaude),
              AbsolutePath.make(path.join(directory, ".claude")),
              AbsolutePath.make(path.join(root, ".claude")),
              AbsolutePath.make(globalAgents),
              AbsolutePath.make(path.join(directory, ".agents")),
              AbsolutePath.make(path.join(root, ".agents")),
              "global",
              AbsolutePath.make(global),
              "outside",
              AbsolutePath.make(path.join(tmp.path, "opencode.json")),
              "root",
              AbsolutePath.make(path.join(root, "opencode.json")),
              "parent",
              AbsolutePath.make(path.join(parent, "opencode.jsonc")),
              "directory",
              AbsolutePath.make(path.join(directory, "opencode.json")),
              "root-dot",
              AbsolutePath.make(path.join(root, ".opencode")),
              "directory-dot",
              AbsolutePath.make(path.join(directory, ".opencode")),
            ])
          }).pipe(
            Effect.provide(
              testLayer(directory, global, root, {
                type: "git",
                store: AbsolutePath.make(path.join(root, ".git")),
              }),
            ),
          )
        })
      }),
    ),
  )
})
