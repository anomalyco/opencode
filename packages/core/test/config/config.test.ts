import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigProvider } from "@opencode-ai/core/config/provider"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { Policy } from "@opencode-ai/core/policy"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

function testLayer(
  directory: string,
  globalDirectory = path.join(directory, "global"),
  projectDirectory = directory,
  vcs?: Project.Vcs,
) {
  return Config.layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Global.layerWith({ config: globalDirectory })),
    Layer.provideMerge(Policy.defaultLayer),
    Layer.provide(
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location(
            { directory: AbsolutePath.make(directory) },
            { projectDirectory: AbsolutePath.make(projectDirectory), vcs },
          ),
        ),
      ),
    ),
  )
}

const provider = {
  endpoint: { type: "unknown" },
  options: {
    headers: {},
    body: {},
    aisdk: {
      provider: {},
      request: {},
    },
  },
  models: {},
}

describe("Config", () => {
  it.live("returns an empty configuration when directory files do not exist", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const config = yield* Config.Service
          const documents = yield* config.get()

          expect(documents).toEqual([])
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )

  it.live("loads JSON and JSONC files from lowest to highest priority", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(
                path.join(tmp.path, "config.json"),
                JSON.stringify({ $schema: "base", providers: { base: provider } }),
              ),
              fs.writeFile(
                path.join(tmp.path, "opencode.json"),
                JSON.stringify({ $schema: "middle", providers: { middle: provider } }),
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
            const documents = yield* config.get()

            expect(documents).toHaveLength(3)
            expect(documents.map((document) => document.source.type)).toEqual(["file", "file", "file"])
            expect(documents.map((document) => document.info.$schema)).toEqual(["base", "middle", "last"])
            expect(documents[0]).toBeInstanceOf(Config.Loaded)
            expect(documents[0]?.source.type === "file" ? documents[0].source.path : undefined).toBe(
              path.join(tmp.path, "config.json"),
            )
            expect(documents[2]?.info.providers?.last).toBeInstanceOf(ConfigProvider.Info)

            yield* Effect.promise(() =>
              fs.writeFile(path.join(tmp.path, "opencode.jsonc"), JSON.stringify({ $schema: "changed" })),
            )
            expect((yield* config.get()).map((document) => document.info.$schema)).toEqual(["base", "middle", "last"])
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
            experimental: { policies: [{ effect: "deny", action: "provider.use", resource: "openai" }] },
            providers: { local: provider },
          })
          yield* Effect.promise(() => fs.writeFile(file, contents))

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = yield* config.get()

            expect(documents[0]?.info.$schema).toBeUndefined()
            expect(documents[0]?.info.shell).toBe("/bin/zsh")
            expect(documents[0]?.info.experimental?.policies?.[0]).toEqual({
              effect: "deny",
              action: "provider.use",
              resource: "openai",
            })
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
                autoupdate: "notify",
                share: "disabled",
                enterprise: { url: "https://share.example.com" },
                username: "test-user",
                permissions: [
                  { permission: "bash", pattern: "*", action: "ask" },
                  { permission: "bash", pattern: "git status", action: "allow" },
                ],
                agents: {
                  reviewer: {
                    model: "openrouter/openai/gpt-5",
                    variant: "high",
                    options: {
                      headers: { "x-agent": "reviewer" },
                      aisdk: { request: { reasoningEffort: "high" } },
                    },
                    description: "Review changes for correctness",
                    system: "Find regressions.",
                    mode: "subagent",
                    hidden: false,
                    color: "warning",
                    steps: 12,
                    disabled: false,
                    permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
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
                  timeout: 5000,
                  servers: {
                    local: {
                      type: "local",
                      command: ["node", "./mcp/server.js"],
                      environment: { API_KEY: "secret" },
                      disabled: false,
                      timeout: 10000,
                    },
                    remote: {
                      type: "remote",
                      url: "https://mcp.example.com/mcp",
                      headers: { Authorization: "Bearer token" },
                      oauth: { client_id: "client", scope: "read write", callback_port: 19876 },
                      disabled: true,
                    },
                  },
                },
                compaction: {
                  auto: true,
                  prune: false,
                  keep: { turns: 3, tokens: 2000 },
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
            const documents = yield* config.get()

            expect(documents).toHaveLength(1)
            expect(documents[0]?.info.shell).toBe("/bin/bash")
            expect(documents[0]?.info.model).toBe("anthropic/claude")
            expect(documents[0]?.info.autoupdate).toBe("notify")
            expect(documents[0]?.info.share).toBe("disabled")
            expect(documents[0]?.info.enterprise).toEqual({ url: "https://share.example.com" })
            expect(documents[0]?.info.username).toBe("test-user")
            expect(documents[0]?.info.permissions).toEqual([
              { permission: "bash", pattern: "*", action: "ask" },
              { permission: "bash", pattern: "git status", action: "allow" },
            ])
            expect(documents[0]?.info.agents?.reviewer).toEqual({
              model: "openrouter/openai/gpt-5",
              variant: "high",
              options: {
                headers: { "x-agent": "reviewer" },
                aisdk: { request: { reasoningEffort: "high" } },
              },
              description: "Review changes for correctness",
              system: "Find regressions.",
              mode: "subagent",
              hidden: false,
              color: "warning",
              steps: 12,
              disabled: false,
              permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
            })
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
              timeout: 5000,
              servers: {
                local: {
                  type: "local",
                  command: ["node", "./mcp/server.js"],
                  environment: { API_KEY: "secret" },
                  disabled: false,
                  timeout: 10000,
                },
                remote: {
                  type: "remote",
                  url: "https://mcp.example.com/mcp",
                  headers: { Authorization: "Bearer token" },
                  oauth: { client_id: "client", scope: "read write", callback_port: 19876 },
                  disabled: true,
                },
              },
            })
            expect(documents[0]?.info.compaction).toEqual({
              auto: true,
              prune: false,
              keep: { turns: 3, tokens: 2000 },
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

  it.live("ignores invalid files while loading valid config values", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(path.join(tmp.path, "config.json"), JSON.stringify({ $schema: "base" })),
              fs.writeFile(path.join(tmp.path, "opencode.json"), "{ invalid"),
              fs.writeFile(path.join(tmp.path, "opencode.jsonc"), JSON.stringify({ providers: { invalid: true } })),
            ]),
          )
          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const documents = yield* config.get()

            expect(documents.map((document) => document.info.$schema)).toEqual(["base"])
          }).pipe(Effect.provide(testLayer(tmp.path)))
        }),
      ),
    ),
  )

  it.live("loads policy statements in reverse config order", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const global = path.join(tmp.path, "global")
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.writeFile(
              path.join(global, "opencode.json"),
              JSON.stringify({
                experimental: { policies: [{ effect: "deny", action: "provider.use", resource: "openai" }] },
              }),
            )
            await fs.writeFile(
              path.join(tmp.path, "opencode.json"),
              JSON.stringify({
                experimental: { policies: [{ effect: "allow", action: "provider.use", resource: "openai" }] },
              }),
            )
          })

          return yield* Effect.gen(function* () {
            const policy = yield* Policy.Service

            expect(yield* policy.evaluate("provider.use", "openai", "allow")).toBe("deny")
          }).pipe(Effect.provide(testLayer(tmp.path, global)))
        })
      }),
    ),
  )

  it.live("loads global, ancestor, and .opencode configuration up to the project boundary", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const global = path.join(tmp.path, "global")
        const root = path.join(tmp.path, "repo")
        const parent = path.join(root, "packages")
        const directory = path.join(parent, "app")
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.mkdir(path.join(root, ".opencode"), { recursive: true })
            await fs.mkdir(path.join(directory, ".opencode"), { recursive: true })
            await Promise.all([
              fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({ $schema: "outside" })),
              fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ $schema: "global" })),
              fs.writeFile(path.join(root, "opencode.json"), JSON.stringify({ $schema: "root" })),
              fs.writeFile(path.join(parent, "opencode.jsonc"), JSON.stringify({ $schema: "parent" })),
              fs.writeFile(path.join(directory, "config.json"), JSON.stringify({ $schema: "directory" })),
              fs.writeFile(path.join(root, ".opencode", "opencode.json"), JSON.stringify({ $schema: "root-dot" })),
              fs.writeFile(
                path.join(directory, ".opencode", "opencode.jsonc"),
                JSON.stringify({ $schema: "directory-dot" }),
              ),
            ])
          })

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const directories = yield* config.directories()
            const documents = yield* config.get()

            expect(directories).toEqual([
              AbsolutePath.make(global),
              AbsolutePath.make(path.join(root, ".opencode")),
              AbsolutePath.make(path.join(directory, ".opencode")),
            ])
            expect(documents.map((document) => document.info.$schema)).toEqual([
              "global",
              "root",
              "parent",
              "directory",
              "root-dot",
              "directory-dot",
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
