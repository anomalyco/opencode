import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { DateTime, Effect, Layer } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Skill } from "@opencode-ai/core/skill"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { Bus } from "@opencode-ai/core/bus"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Image } from "@opencode-ai/core/image"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Model } from "@opencode-ai/core/model"
import { Permission } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { Provider } from "@opencode-ai/core/provider"
import { ReadTool } from "@opencode-ai/core/tool/plugin/read"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInstructions } from "@opencode-ai/core/session/instructions"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Session } from "@opencode-ai/core/session"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { Tool } from "@opencode-ai/core/tool"
import { tempLocationLayer } from "./fixture/location"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { globalProjectNode } from "./lib/project"
import { executeTool, registerToolPlugin } from "./lib/tool"

const readToolNode = makeLocationNode({
  name: "test/read-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(ReadTool.Plugin)),
  deps: [
    Agent.node,
    Skill.node,
    Tool.node,
    ReadToolFileSystem.node,
    LocationMutation.node,
    Image.node,
    Permission.node,
    SessionInstructions.node,
    FSUtil.node,
    Location.node,
  ],
})

const permission = permissionLayer({ assert: () => Effect.void })
const config = Config.testLayer()
const imageLayer = AppNodeBuilder.build(Image.node, [Config.node.replace(config)])

const testLayer = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    Bus.node,
    SessionProjector.node,
    SessionStore.node,
    Session.node,
    Location.node,
    FSUtil.node,
    LocationMutation.node,
    ReadToolFileSystem.node,
    readToolNode,
    Tool.node,
    PluginHooks.node,
    SessionInstructions.node,
    Global.node,
    Image.node,
  ]),
  [
    Project.node.replace(globalProjectNode),
    SessionExecution.node.replace(SessionExecution.noopLayer),
    Location.node.replace(tempLocationLayer),
    Permission.node.replace(permission),
    Config.node.replace(config),
    Image.node.replace(imageLayer),
  ],
)

const it = testEffect(testLayer)

const identity = {
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_nearby"),
}
const readCall = (sessionID: Session.ID, id: string, readPath: string): Parameters<Tool.Snapshot["execute"]>[0] => ({
  sessionID,
  ...identity,
  call: { type: "tool-call", id, name: "read", input: { path: readPath } },
})

const writeAgents = (file: string, content: string) => Effect.promise(() => fs.writeFile(file, content))
const mkdir = (dir: string) => Effect.promise(() => fs.mkdir(dir, { recursive: true }))

const synthetics = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    return (yield* store.context(sessionID)).filter((message) => message.type === "synthetic")
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
      yield* writeAgents(otherPath, "other-instructions")
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

      // A sibling read under sub/other discovers only the new AGENTS.md; sub is already
      // injected for this session so it is not re-emitted, and the root is still excluded.
      yield* executeTool(registry, readCall(sessionID, "call-other", "sub/other/file2.txt"))

      const secondInjected = yield* synthetics(sessionID)
      expect(secondInjected).toHaveLength(2)
      expect(secondInjected[1]!.text).toBe(`Instructions from: ${otherPath}\nother-instructions`)
      expect(secondInjected[1]!.description).toBe(`Loaded ${path.relative(dir, otherPath)}`)
      expect(secondInjected[1]!.metadata).toEqual({ instruction: { paths: [otherPath] } })
      expect(secondInjected.some((message) => message.text.includes("root-instructions"))).toBe(false)
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
      yield* bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "" })
      yield* bus.publish(SessionEvent.Compaction.Ended, { sessionID, reason: "manual", text: "summary", recent: "" })
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
    // Metadata is bookkeeping for the dedup ledger; the model must not see it.
    expect(messages[0]!.metadata).toBeUndefined()
  })
})
