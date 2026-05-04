import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instruction } from "../../src/session/instruction"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Global } from "@opencode-ai/core/global"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer))

const configLayer = TestConfig.layer()

const instructionLayer = (global: Partial<Global.Interface>) =>
  Instruction.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Global.layerWith(global)),
  )

const provideInstruction =
  (global: Partial<Global.Interface>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.provide(instructionLayer(global)))

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

const writeFiles = (dir: string, files: Record<string, string>) =>
  Effect.all(
    Object.entries(files).map(([file, content]) => write(path.join(dir, file), content)),
    { discard: true },
  )

const withFiles = <A, E, R>(files: Record<string, string>, self: (dir: string) => Effect.Effect<A, E, R>) =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* writeFiles(dir, files)
      return yield* self(dir).pipe(provideInstruction({ home: dir, config: dir }))
    }),
  )

const tmpWithFiles = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* writeFiles(dir, files)
    return dir
  })

function loaded(filepath: string): MessageV2.WithParts[] {
  const sessionID = SessionID.make("session-loaded-1")
  const messageID = MessageID.make("message-loaded-1")

  return [
    {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: "build",
        model: {
          providerID: ProviderID.make("anthropic"),
          modelID: ModelID.make("claude-sonnet-4-20250514"),
        },
      },
      parts: [
        {
          id: PartID.make("part-loaded-1"),
          messageID,
          sessionID,
          type: "tool",
          callID: "call-loaded-1",
          tool: "read",
          state: {
            status: "completed",
            input: {},
            output: "done",
            title: "Read",
            metadata: { loaded: [filepath] },
            time: { start: 0, end: 1 },
          },
        },
      ],
    },
  ]
}

describe("Instruction.resolve", () => {
  it.live("returns empty when AGENTS.md is at project root (already in systemPaths)", () =>
    withFiles({ "AGENTS.md": "# Root Instructions", "src/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "AGENTS.md"))).toBe(true)

        const results = yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("message-test-1"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("returns AGENTS.md from subdirectory (not in systemPaths)", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "subdir", "AGENTS.md"))).toBe(false)

        const results = yield* svc.resolve(
          [],
          path.join(dir, "subdir", "nested", "file.ts"),
          MessageID.make("message-test-2"),
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
      }),
    ),
  )

  it.live("doesn't reload AGENTS.md when reading it directly", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "AGENTS.md")
        const system = yield* svc.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = yield* svc.resolve([], filepath, MessageID.make("message-test-3"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("does not reattach the same nearby instructions twice for one message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("message-claim-1")

        const first = yield* svc.resolve([], filepath, id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(first[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
        expect(second).toEqual([])
      }),
    ),
  )

  it.live("clear allows nearby instructions to be attached again for the same message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("message-claim-2")

        const first = yield* svc.resolve([], filepath, id)
        yield* svc.clear(id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
        expect(second[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
      }),
    ),
  )

  it.live("skips instructions already reported by prior read metadata", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const agents = path.join(dir, "subdir", "AGENTS.md")
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("message-claim-3")

        const results = yield* svc.resolve(loaded(agents), filepath, id)
        expect(results).toEqual([])
      }),
    ),
  )

  test.todo("fetches remote instructions from config URLs via HttpClient", () => {})
})

describe("Instruction.system", () => {
  it.live("loads both project and global AGENTS.md when both exist", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpWithFiles({ "AGENTS.md": "# Project Instructions" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(projectTmp, "AGENTS.md"))).toBe(true)
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)

        const rules = yield* svc.system()
        expect(rules).toHaveLength(2)
        expect(rules[0]).toBe(`Instructions from: ${path.join(globalTmp, "AGENTS.md")}\n# Global Instructions`)
        expect(rules[1]).toBe(`Instructions from: ${path.join(projectTmp, "AGENTS.md")}\n# Project Instructions`)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )
})

describe("Instruction.systemPaths global config", () => {
  it.live("uses Global.Service config AGENTS.md", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )
})
