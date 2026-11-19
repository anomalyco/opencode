import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { DateTime, Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Environment } from "@opencode/core/environment/index"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Session } from "@opencode/core/session"
import { Skill } from "@opencode/core/skill"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Tool } from "@opencode/core/tool"
import { location, tempLocationLayer } from "./fixture/location"
import { AbsolutePath } from "@opencode/core/schema"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { globalProjectNode } from "./lib/project"
import { executeTool, registerToolPlugin } from "./lib/tool"

const readToolNode = makeLocationNode({
  name: "test/read-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(ReadTool.Plugin)),
  deps: [
    Tool.node,
    FileAccess.node,
    Image.node,
    Permission.node,
    SessionInstructions.node,
    InstructionDiscovery.node,
    Skill.node,
    FSUtil.node,
    Environment.node,
    Location.node,
    Config.node,
    Flag.node,
  ],
})

const permission = permissionLayer({ assert: () => Effect.void })
const config = Config.testLayer()
const imageLayer = AppNodeBuilder.build(Image.node, [Config.node.replace(config)])

const group = LayerNode.group([
  Database.node,
  Bus.node,
  SessionProjector.node,
  SessionStore.node,
  Session.node,
  Location.node,
  FSUtil.node,
  FileAccess.node,
  readToolNode,
  Tool.node,
  PluginHooks.node,
  SessionInstructions.node,
  Skill.node,
  Global.node,
  Image.node,
])

const buildLayer = (locationLayer: Layer.Layer<Location.Service>) =>
  AppNodeBuilder.build(group, [
    Project.node.replace(globalProjectNode),
    SessionExecution.node.replace(SessionExecution.noopLayer),
    Location.node.replace(locationLayer),
    Permission.node.replace(permission),
    Config.node.replace(config),
    Image.node.replace(imageLayer),
  ])

const testLayer = buildLayer(tempLocationLayer)

// A Location whose directory is a symlink to its project directory: `run` takes the directory from $PWD, which
// does not follow the link.
const symlinkLocationLayer = Layer.unwrap(
  Effect.acquireRelease(
    Effect.promise(async () => {
      const base = await fs.mkdtemp(path.join(os.tmpdir(), "location-"))
      const real = path.join(base, "real")
      const link = path.join(base, "link")
      await fs.mkdir(real)
      await fs.symlink(real, link, process.platform === "win32" ? "junction" : "dir")
      return { base, real, link }
    }),
    (created) => Effect.promise(() => fs.rm(created.base, { recursive: true, force: true })),
  ).pipe(
    Effect.map((created) =>
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location(Location.Ref.make({ directory: AbsolutePath.make(created.link) }), {
            projectDirectory: AbsolutePath.make(created.real),
          }),
        ),
      ),
    ),
  ),
)

const it = testEffect(testLayer)
const itSymlink = testEffect(buildLayer(symlinkLocationLayer))

const identity = {
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_nearby"),
}
const readCall = (
  sessionID: Session.ID,
  id: string,
  readPath: string,
  page: ReadToolFileSystem.PageInput = {},
): Parameters<Tool.Snapshot["execute"]>[0] => ({
  sessionID,
  ...identity,
  call: { type: "tool-call", id, name: "read", input: { path: readPath, ...page } },
})

const writeAgents = (file: string, content: string) => Effect.promise(() => fs.writeFile(file, content))
const mkdir = (dir: string) => Effect.promise(() => fs.mkdir(dir, { recursive: true }))

// The instruction ledger reads only synthetic rows; they must match what full history shows the model.
const synthetics = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const { db } = yield* Database.Service
    const visible = (yield* store.context(sessionID)).filter((message) => message.type === "synthetic")
    expect(yield* SessionHistory.synthetics(db, sessionID)).toEqual(visible)
    return visible
  })

// Seed a prior synthetic message with an instruction dedup ledger, simulating a prior turn
// after the Location layer was reopened (in-memory set empty).
const seedSynthetic = (sessionID: Session.ID, paths: string[]) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    yield* bus.publish(SessionEvent.Synthetic, {
      sessionID,
      text: `Instructions from: ${paths[0]}\nprior`,
      description: `Loaded ${paths[0]}`,
      metadata: { instruction: { paths } },
    })
  })

describe("SessionInstructions", () => {
  it.live("injects AGENTS.md files above a read, excludes the Location root, and dedups across reads", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const dir = location.directory
      const rootPath = path.resolve(dir, "AGENTS.md")
      const subPath = path.resolve(dir, "sub", "AGENTS.md")
      const deepPath = path.resolve(dir, "sub", "deep", "AGENTS.md")
      const otherPath = path.resolve(dir, "sub", "other", "AGENTS.md")
      yield* mkdir(path.dirname(deepPath))
      yield* mkdir(path.dirname(otherPath))
      yield* writeAgents(rootPath, "root-instructions")
      yield* writeAgents(subPath, "sub-instructions")
      yield* writeAgents(deepPath, "deep-instructions")
      yield* writeAgents(otherPath, "other-instructions\nmore rules")
      yield* Effect.promise(() => fs.writeFile(path.resolve(dir, "sub", "deep", "file.txt"), "file content"))
      yield* Effect.promise(() => fs.writeFile(path.resolve(dir, "sub", "other", "file2.txt"), "file content 2"))

      const session = yield* Session.Service
      const registry = yield* Tool.Service
      const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: dir }) })).id

      // A read deep under sub/ discovers deep and sub AGENTS.md, walking up to but
      // excluding the Location root (already supplied by core initial instructions).
      yield* executeTool(registry, readCall(sessionID, "call-deep", "sub/deep/file.txt"))

      const firstInjected = yield* synthetics(sessionID)
      expect(firstInjected).toHaveLength(1)
      expect(firstInjected[0]!.text).toBe(
        `Instructions from: ${deepPath}\ndeep-instructions\n\nInstructions from: ${subPath}\nsub-instructions`,
      )
      expect(firstInjected[0]!.description).toBe(
        `Loaded ${path.relative(dir, deepPath)}, ${path.relative(dir, subPath)}`,
      )
      // The synthetic's metadata carries the durable dedup ledger.
      expect(firstInjected[0]!.metadata).toEqual({ instruction: { paths: [deepPath, subPath] } })
      expect(firstInjected[0]!.text).not.toContain("root-instructions")

      // Neither a full nor a partial read adds an automatic copy of the file itself.
      const read = yield* executeTool(registry, readCall(sessionID, "call-direct", "sub/other/AGENTS.md"))
      expect(read.content?.[0]).toMatchObject({ type: "text", text: expect.stringContaining("more rules") })
      const partial = yield* executeTool(
        registry,
        readCall(sessionID, "call-partial", "sub/other/AGENTS.md", { limit: 1 }),
      )
      expect(partial.metadata).toEqual({ truncated: true })
      expect(yield* synthetics(sessionID)).toHaveLength(1)

      // A sibling read under sub/other discovers only the new AGENTS.md; sub is already
      // injected for this session so it is not re-emitted, and the root is still excluded.
      yield* executeTool(registry, readCall(sessionID, "call-other", "sub/other/file2.txt"))

      const secondInjected = yield* synthetics(sessionID)
      expect(secondInjected).toHaveLength(2)
      expect(secondInjected[1]!.text).toBe(`Instructions from: ${otherPath}\nother-instructions\nmore rules`)
      expect(secondInjected[1]!.description).toBe(`Loaded ${path.relative(dir, otherPath)}`)
      expect(secondInjected[1]!.metadata).toEqual({ instruction: { paths: [otherPath] } })
      expect(secondInjected.some((message) => message.text.includes("root-instructions"))).toBe(false)
    }),
  )

  it.live("falls back to CLAUDE.md above a read where a directory has no AGENTS.md", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const dir = location.directory
      const subAgents = path.resolve(dir, "sub", "AGENTS.md")
      const deepClaude = path.resolve(dir, "sub", "deep", "CLAUDE.md")
      yield* mkdir(path.resolve(dir, "sub", "deep"))
      yield* writeAgents(subAgents, "sub-agents")
      yield* writeAgents(path.resolve(dir, "sub", "CLAUDE.md"), "sub-claude")
      yield* writeAgents(deepClaude, "deep-claude")
      yield* Effect.promise(() => fs.writeFile(path.resolve(dir, "sub", "deep", "file.txt"), "content"))

      const session = yield* Session.Service
      const registry = yield* Tool.Service
      const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: dir }) })).id
      yield* executeTool(registry, readCall(sessionID, "call-deep", "sub/deep/file.txt"))

      const injected = yield* synthetics(sessionID)
      expect(injected).toHaveLength(1)
      expect(injected[0]!.text).toBe(
        `Instructions from: ${deepClaude}\ndeep-claude\n\nInstructions from: ${subAgents}\nsub-agents`,
      )
    }),
  )

  it.live("does not re-inject paths already recorded in durable session history", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const dir = location.directory
      const rootPath = path.resolve(dir, "AGENTS.md")
      const subPath = path.resolve(dir, "sub", "AGENTS.md")
      yield* mkdir(path.resolve(dir, "sub"))
      yield* writeAgents(rootPath, "root-instructions")
      yield* writeAgents(subPath, "sub-instructions")
      yield* Effect.promise(() => fs.writeFile(path.resolve(dir, "sub", "file.txt"), "content"))

      const session = yield* Session.Service
      const registry = yield* Tool.Service
      const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: dir }) })).id

      // Seed the durable history with a prior synthetic that already claims sub's AGENTS.md
      // via the instruction metadata ledger.
      yield* seedSynthetic(sessionID, [subPath])
      expect(yield* synthetics(sessionID)).toHaveLength(1)

      yield* executeTool(registry, readCall(sessionID, "call-sub", "sub/file.txt"))

      // The durable claim on the prior synthetic prevents re-injection; no new synthetic.
      expect(yield* synthetics(sessionID)).toHaveLength(1)
    }),
  )

  it.live(
    "discovers AGENTS.md on a directory listing, including the listed directory's own, and dedups with a later file read",
    () =>
      Effect.gen(function* () {
        const location = yield* Location.Service
        const dir = location.directory
        const rootPath = path.resolve(dir, "AGENTS.md")
        const pkgPath = path.resolve(dir, "packages", "foo", "AGENTS.md")
        yield* mkdir(path.resolve(dir, "packages", "foo"))
        yield* writeAgents(rootPath, "root-instructions")
        yield* writeAgents(pkgPath, "pkg-instructions")
        yield* Effect.promise(() => fs.writeFile(path.resolve(dir, "packages", "foo", "file.txt"), "content"))

        const session = yield* Session.Service
        const registry = yield* Tool.Service
        const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: dir }) })).id

        // Listing packages/foo/ discovers its own AGENTS.md, walking up to but excluding
        // the Location root (already supplied by core initial instructions).
        yield* executeTool(registry, readCall(sessionID, "call-list", "packages/foo"))

        const firstInjected = yield* synthetics(sessionID)
        expect(firstInjected).toHaveLength(1)
        expect(firstInjected[0]!.text).toBe(`Instructions from: ${pkgPath}\npkg-instructions`)
        expect(firstInjected[0]!.description).toBe(`Loaded ${path.relative(dir, pkgPath)}`)
        expect(firstInjected[0]!.metadata).toEqual({ instruction: { paths: [pkgPath] } })
        expect(firstInjected[0]!.text).not.toContain("root-instructions")

        // A subsequent file read under the listed directory is a dedup: pkg's AGENTS.md is
        // already injected for this session, so nothing new is emitted.
        yield* executeTool(registry, readCall(sessionID, "call-file", "packages/foo/file.txt"))

        expect(yield* synthetics(sessionID)).toHaveLength(1)
      }),
  )

  it.live("re-injects nested instructions dropped from history by compaction", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const dir = location.directory
      const subPath = path.resolve(dir, "sub", "AGENTS.md")
      yield* mkdir(path.resolve(dir, "sub"))
      yield* writeAgents(path.resolve(dir, "AGENTS.md"), "root-instructions")
      yield* writeAgents(subPath, "sub-instructions")
      yield* Effect.promise(() => fs.writeFile(path.resolve(dir, "sub", "file.txt"), "content"))

      const session = yield* Session.Service
      const registry = yield* Tool.Service
      const bus = yield* Bus.Service
      const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: dir }) })).id

      yield* executeTool(registry, readCall(sessionID, "call-before", "sub/file.txt"))
      expect(yield* synthetics(sessionID)).toHaveLength(1)

      // A completed compaction truncates model-visible history at its boundary, dropping
      // the synthetic that carried sub's instructions.
      yield* bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual" })
      yield* bus.publish(SessionEvent.Compaction.Ended, { sessionID, reason: "manual", text: "summary" })
      expect(yield* synthetics(sessionID)).toHaveLength(0)

      // The model no longer has the rules, so the next read under the subtree must
      // re-inject them rather than trusting a stale in-memory claim.
      yield* executeTool(registry, readCall(sessionID, "call-after", "sub/file.txt"))
      expect(yield* synthetics(sessionID)).toHaveLength(1)
    }),
  )

  it.live("listing the Location root directory injects no instructions", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const dir = location.directory
      const rootPath = path.resolve(dir, "AGENTS.md")
      const subPath = path.resolve(dir, "sub", "AGENTS.md")
      yield* mkdir(path.resolve(dir, "sub"))
      yield* writeAgents(rootPath, "root-instructions")
      yield* writeAgents(subPath, "sub-instructions")

      const session = yield* Session.Service
      const registry = yield* Tool.Service
      const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: dir }) })).id

      // The walk starts and stops at the Location root: the root AGENTS.md is searched but
      // dropped by the dirname filter, and up() only walks upward so nested dirs are unseen.
      yield* executeTool(registry, readCall(sessionID, "call-root-list", "."))

      expect(yield* synthetics(sessionID)).toHaveLength(0)
    }),
  )

  it.live("loads instructions directly without a read", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const dir = location.directory
      const subPath = path.resolve(dir, "sub", "AGENTS.md")
      yield* mkdir(path.resolve(dir, "sub"))
      yield* writeAgents(subPath, "sub-instructions")

      const session = yield* Session.Service
      const sessionInstructions = yield* SessionInstructions.Service
      const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: dir }) })).id

      yield* sessionInstructions.load({ sessionID, paths: [subPath] })

      const injected = yield* synthetics(sessionID)
      expect(injected).toHaveLength(1)
      expect(injected[0]!.text).toBe(`Instructions from: ${subPath}\nsub-instructions`)
      expect(injected[0]!.description).toBe(`Loaded ${path.relative(dir, subPath)}`)
      expect(injected[0]!.metadata).toEqual({ instruction: { paths: [subPath] } })
    }),
  )

  it.live("does not follow a directory symlink out of the Location when discovering AGENTS.md", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const dir = location.directory
      // The skill store lives outside the Location, and `.agents/skills` links to it.
      const store = yield* Effect.promise(() => fs.mkdtemp(path.join(path.dirname(dir), "store-")))
      yield* mkdir(path.resolve(store, "proj", "skills", "s"))
      yield* writeAgents(path.resolve(store, "AGENTS.md"), "store-instructions")
      yield* writeAgents(path.resolve(store, "proj", "AGENTS.md"), "root-instructions")
      yield* Effect.promise(() => fs.writeFile(path.resolve(store, "proj", "skills", "s", "SKILL.md"), "skill"))
      yield* mkdir(path.resolve(dir, ".agents"))
      yield* Effect.promise(() =>
        fs.symlink(
          path.resolve(store, "proj", "skills"),
          path.resolve(dir, ".agents", "skills"),
          process.platform === "win32" ? "junction" : "dir",
        ),
      )

      const session = yield* Session.Service
      const registry = yield* Tool.Service
      const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: dir }) })).id

      // Walking up the link target would leave the Location and reach the store's AGENTS.md files.
      yield* executeTool(registry, readCall(sessionID, "call-skill", ".agents/skills/s/SKILL.md"))

      expect((yield* synthetics(sessionID)).map((message) => message.text)).toEqual([])
    }),
  )

  itSymlink.live("does not re-inject the Location root when the Location is a symlink", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const real = location.project.directory
      yield* mkdir(path.resolve(real, "sub"))
      yield* writeAgents(path.resolve(real, "AGENTS.md"), "real-root")
      yield* Effect.promise(() => fs.writeFile(path.resolve(real, "sub", "f.txt"), "content"))

      const session = yield* Session.Service
      const registry = yield* Tool.Service
      const sessionID = (yield* session.create({ location: Location.Ref.make({ directory: location.directory }) })).id

      // The read path is inside the resolved project directory, so a lexical walk from it passes the symlinked
      // Location without reaching it.
      yield* executeTool(registry, readCall(sessionID, "call-real", path.resolve(real, "sub", "f.txt")))

      expect((yield* synthetics(sessionID)).map((message) => message.text)).toEqual([])
    }),
  )

  test("toLLMMessages does not forward synthetic metadata to the provider", () => {
    const created = DateTime.makeUnsafe(0)
    const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })
    const synthetic = SessionMessage.Synthetic.make({
      id: SessionMessage.ID.make("msg_synthetic"),
      type: "synthetic",
      text: "Instructions from: /repo/sub/AGENTS.md\ncontent",
      description: "Loaded /repo/sub/AGENTS.md",
      metadata: { instruction: { paths: ["/repo/sub/AGENTS.md"] } },
      time: { created },
    })
    const messages = toLLMMessages([synthetic], model)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe("user")
    expect(messages[0]!.content).toEqual([{ type: "text", text: "Instructions from: /repo/sub/AGENTS.md\ncontent" }])
  })
})
