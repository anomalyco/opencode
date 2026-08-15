import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@moks/core/v1/session"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { CrossSpawnSpawner } from "@moks/core/cross-spawn-spawner"

import { Instruction } from "../../src/session/instruction"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Global } from "@moks/core/global"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { ProviderV2 } from "@moks/core/provider"
import { ModelV2 } from "@moks/core/model"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { LayerNode } from "@moks/core/effect/layer-node"
import { LayerNodePlatform } from "@moks/core/effect/app-node-platform"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Config } from "@/config/config"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem, InstanceStore.node]), [
    [
      InstanceBootstrap.node,
      Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
    ],
  ]),
)

const configLayer = Layer.succeed(Config.Service, TestConfig.make())

const instructionLayer = (global: Partial<Global.Interface>, flags: Partial<RuntimeFlags.Info> = {}) =>
  AppNodeBuilder.build(Instruction.node, [
    [Config.node, configLayer],
    [Global.node, Global.layerWith(global)],
    [RuntimeFlags.node, RuntimeFlags.layer(flags)],
  ])

const provideInstruction =
  (global: Partial<Global.Interface>, flags?: Partial<RuntimeFlags.Info>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.provide(instructionLayer(global, flags)))

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

function loaded(filepath: string): SessionV1.WithParts[] {
  const sessionID = SessionID.make("session-loaded-1")
  const messageID = MessageID.make("msg_message-loaded-1")

  return [
    {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: "recruit",
        model: {
          providerID: ProviderV2.ID.make("anthropic"),
          modelID: ModelV2.ID.make("claude-sonnet-4-20250514"),
        },
      },
      parts: [
        {
          id: PartID.make("prt_part-loaded-1"),
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
  it.live("returns empty when HIRING.md is at project root (already in systemPaths)", () =>
    withFiles({ "HIRING.md": "# Root Instructions", "src/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "HIRING.md"))).toBe(true)

        const results = yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_message-test-1"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("returns HIRING.md from subdirectory (not in systemPaths)", () =>
    withFiles({ "subdir/HIRING.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "subdir", "HIRING.md"))).toBe(false)

        const results = yield* svc.resolve(
          [],
          path.join(dir, "subdir", "nested", "file.ts"),
          MessageID.make("msg_message-test-2"),
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(dir, "subdir", "HIRING.md"))
      }),
    ),
  )

  it.live("doesn't reload HIRING.md when reading it directly", () =>
    withFiles({ "subdir/HIRING.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "HIRING.md")
        const system = yield* svc.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = yield* svc.resolve([], filepath, MessageID.make("msg_message-test-3"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("does not reattach the same nearby instructions twice for one message", () =>
    withFiles({ "subdir/HIRING.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-1")

        const first = yield* svc.resolve([], filepath, id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(first[0].filepath).toBe(path.join(dir, "subdir", "HIRING.md"))
        expect(second).toEqual([])
      }),
    ),
  )

  it.live("clear allows nearby instructions to be attached again for the same message", () =>
    withFiles({ "subdir/HIRING.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-2")

        const first = yield* svc.resolve([], filepath, id)
        yield* svc.clear(id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
        expect(second[0].filepath).toBe(path.join(dir, "subdir", "HIRING.md"))
      }),
    ),
  )

  it.live("does not walk out of the company to attach a parent software HIRING.md", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpdirScoped()
      const root = yield* tmpdirScoped()
      yield* writeFiles(root, {
        "HIRING.md": "# Software",
        "acme/HIRING.md": "# Acme",
        "acme/src/file.ts": "const x = 1",
      })
      const company = path.join(root, "acme")

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const results = yield* svc.resolve([], path.join(company, "src", "file.ts"), MessageID.make("msg_message-test-4"))
        expect(results).toEqual([])
      }).pipe(provideInstance(company), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("skips instructions already reported by prior read metadata", () =>
    withFiles({ "subdir/HIRING.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const agents = path.join(dir, "subdir", "HIRING.md")
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-3")

        const results = yield* svc.resolve(loaded(agents), filepath, id)
        expect(results).toEqual([])
      }),
    ),
  )

  test.todo("fetches remote instructions from config URLs via HttpClient", () => {})
})

describe("Instruction.system", () => {
  it.live("loads both project and global HIRING.md when both exist", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "HIRING.md": "# Global Instructions" })
      const projectTmp = yield* tmpWithFiles({ "HIRING.md": "# Project Instructions" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(projectTmp, "HIRING.md"))).toBe(true)
        expect(paths.has(path.join(globalTmp, "HIRING.md"))).toBe(true)

        const rules = yield* svc.system()
        expect(rules).toHaveLength(2)
        expect(rules[0]).toBe(`Instructions from: ${path.join(globalTmp, "HIRING.md")}\n# Global Instructions`)
        expect(rules[1]).toBe(`Instructions from: ${path.join(projectTmp, "HIRING.md")}\n# Project Instructions`)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("does not attach project or global CLAUDE.md by default", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ ".claude/CLAUDE.md": "# Global Claude" })
      const projectTmp = yield* tmpWithFiles({ "CLAUDE.md": "# Project Claude" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, ".claude", "CLAUDE.md"))).toBe(false)
        expect(paths.has(path.join(projectTmp, "CLAUDE.md"))).toBe(false)
        expect(yield* svc.system()).toEqual([])
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("skips project and global CLAUDE.md when Claude Code prompt is disabled", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ ".claude/CLAUDE.md": "# Global Claude" })
      const projectTmp = yield* tmpWithFiles({ "CLAUDE.md": "# Project Claude" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, ".claude", "CLAUDE.md"))).toBe(false)
        expect(paths.has(path.join(projectTmp, "CLAUDE.md"))).toBe(false)
        expect(yield* svc.system()).toEqual([])
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }, { disableClaudeCodePrompt: true }),
      )
    }),
  )

  it.live("does not load coding AGENTS.md", () =>
    withFiles({ "AGENTS.md": "# Coding constitution" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(dir, "AGENTS.md"))).toBe(false)
        expect(yield* svc.system()).toEqual([])
      }),
    ),
  )

  it.live("loads company and focused req HIRING.md when the packet is cwd", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpdirScoped()
      const root = yield* tmpdirScoped()
      const company = path.join(root, "acme")
      const focused = path.join(company, "senior-backend")
      const sibling = path.join(company, "staff-platform")
      yield* writeFiles(root, {
        "HIRING.md": "# Software",
        "acme/HIRING.md": "# Acme",
        "acme/senior-backend/HIRING.md": "# SB",
        "acme/senior-backend/candidates/.gitkeep": "",
        "acme/senior-backend/candidates/alice.md": "# Alice",
        "acme/staff-platform/HIRING.md": "# SP",
        "acme/staff-platform/candidates/.gitkeep": "",
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(company, "HIRING.md"))).toBe(true)
        expect(paths.has(path.join(focused, "HIRING.md"))).toBe(true)
        expect(paths.has(path.join(sibling, "HIRING.md"))).toBe(false)
        expect(paths.has(path.join(root, "HIRING.md"))).toBe(false)
        expect(paths.has(path.join(focused, "candidates", "alice.md"))).toBe(false)
      }).pipe(provideInstance(focused), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("loads company and focused req HIRING.md from writeFocus", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpdirScoped()
      const company = yield* tmpdirScoped()
      const focused = path.join(company, "senior-backend")
      const sibling = path.join(company, "staff-platform")
      yield* writeFiles(company, {
        "HIRING.md": "# Acme",
        "senior-backend/HIRING.md": "# SB",
        "senior-backend/candidates/.gitkeep": "",
        "staff-platform/HIRING.md": "# SP",
        "staff-platform/candidates/.gitkeep": "",
      })
      yield* Effect.promise(() => ReqWorkspace.writeFocus(company, "senior-backend"))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(company, "HIRING.md"))).toBe(true)
        expect(paths.has(path.join(focused, "HIRING.md"))).toBe(true)
        expect(paths.has(path.join(sibling, "HIRING.md"))).toBe(false)
      }).pipe(provideInstance(company), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("does not load a parent software HIRING.md when the tmp dir is a company", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpdirScoped()
      const root = yield* tmpdirScoped()
      const company = path.join(root, "acme")
      yield* writeFiles(root, {
        "HIRING.md": "# Software",
        "acme/HIRING.md": "# Acme",
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(company, "HIRING.md"))).toBe(true)
        expect(paths.has(path.join(root, "HIRING.md"))).toBe(false)
      }).pipe(provideInstance(company), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("does not attach req materials or candidate cards", () =>
    withFiles(
      {
        "HIRING.md": "# Hiring constitution",
        "jd.md": "# Job Description",
        "scorecard.md": "# Scorecard",
        "notes.md": "# Notes",
        "candidates/alice.md": "# Alice",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const hiring = path.join(dir, "HIRING.md")
          const paths = yield* svc.systemPaths()
          expect(paths.has(hiring)).toBe(true)
          expect(paths.has(path.join(dir, "jd.md"))).toBe(false)
          expect(paths.has(path.join(dir, "scorecard.md"))).toBe(false)
          expect(paths.has(path.join(dir, "notes.md"))).toBe(false)
          expect(paths.has(path.join(dir, "candidates", "alice.md"))).toBe(false)

          const rules = yield* svc.system()
          expect(rules).toEqual([`Instructions from: ${hiring}\n# Hiring constitution`])
        }),
    ),
  )
})

describe("Instruction.systemPaths global config", () => {
  it.live("uses Global.Service config HIRING.md", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "HIRING.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, "HIRING.md"))).toBe(true)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )
})
