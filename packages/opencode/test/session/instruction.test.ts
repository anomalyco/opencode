import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

import { Instruction } from "../../src/session/instruction"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Global } from "@opencode-ai/core/global"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
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

function mentioned(dir: string, slug: string, relative?: string, id = "1"): SessionV1.WithParts {
  const sessionID = SessionID.make("session-focus-1")
  const messageID = MessageID.make(`msg_message-focus-${id}`)
  const rel = relative ?? path.join(".moks", "reqs", slug)
  return {
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
        id: PartID.make(`prt_part-focus-${id}`),
        messageID,
        sessionID,
        type: "file",
        mime: "application/x-directory",
        filename: slug,
        url: `file://${path.join(dir, rel)}`,
        source: {
          type: "file",
          path: rel,
          text: { start: 0, end: 0, value: "" },
        },
      },
    ],
  }
}

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
        agent: "build",
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
  it.live("returns empty when HIRING-AGENTS.md is at project root (already in systemPaths)", () =>
    withFiles({ "HIRING-AGENTS.md": "# Root Instructions", "src/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "HIRING-AGENTS.md"))).toBe(true)

        const results = yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_message-test-1"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("returns HIRING-AGENTS.md from subdirectory (not in systemPaths)", () =>
    withFiles({ "subdir/HIRING-AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "subdir", "HIRING-AGENTS.md"))).toBe(false)

        const results = yield* svc.resolve(
          [],
          path.join(dir, "subdir", "nested", "file.ts"),
          MessageID.make("msg_message-test-2"),
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(dir, "subdir", "HIRING-AGENTS.md"))
      }),
    ),
  )

  it.live("doesn't reload HIRING-AGENTS.md when reading it directly", () =>
    withFiles({ "subdir/HIRING-AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "HIRING-AGENTS.md")
        const system = yield* svc.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = yield* svc.resolve([], filepath, MessageID.make("msg_message-test-3"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("does not reattach the same nearby instructions twice for one message", () =>
    withFiles({ "subdir/HIRING-AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-1")

        const first = yield* svc.resolve([], filepath, id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(first[0].filepath).toBe(path.join(dir, "subdir", "HIRING-AGENTS.md"))
        expect(second).toEqual([])
      }),
    ),
  )

  it.live("clear allows nearby instructions to be attached again for the same message", () =>
    withFiles({ "subdir/HIRING-AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-2")

        const first = yield* svc.resolve([], filepath, id)
        yield* svc.clear(id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
        expect(second[0].filepath).toBe(path.join(dir, "subdir", "HIRING-AGENTS.md"))
      }),
    ),
  )

  it.live("skips instructions already reported by prior read metadata", () =>
    withFiles({ "subdir/HIRING-AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const agents = path.join(dir, "subdir", "HIRING-AGENTS.md")
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
  it.live("loads both project and global HIRING-AGENTS.md when both exist", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "HIRING-AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpWithFiles({ "HIRING-AGENTS.md": "# Project Instructions" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(projectTmp, "HIRING-AGENTS.md"))).toBe(true)
        expect(paths.has(path.join(globalTmp, "HIRING-AGENTS.md"))).toBe(true)

        const rules = yield* svc.system()
        expect(rules).toHaveLength(2)
        expect(rules[0]).toBe(`Instructions from: ${path.join(globalTmp, "HIRING-AGENTS.md")}\n# Global Instructions`)
        expect(rules[1]).toBe(`Instructions from: ${path.join(projectTmp, "HIRING-AGENTS.md")}\n# Project Instructions`)
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

  it.live("attaches .moks/req materials without HIRING-AGENTS.md", () =>
    withFiles(
      {
        ".moks/req/jd.md": "# Job Description",
        ".moks/req/scorecard.md": "# Scorecard",
        ".moks/req/notes.md": "# Notes",
        ".moks/req/resume.md": "# Huge resume should not auto-inject",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const jd = path.join(dir, ".moks", "req", "jd.md")
          const scorecard = path.join(dir, ".moks", "req", "scorecard.md")
          const notes = path.join(dir, ".moks", "req", "notes.md")
          const resume = path.join(dir, ".moks", "req", "resume.md")

          const paths = yield* svc.systemPaths()
          expect(paths.has(jd)).toBe(true)
          expect(paths.has(scorecard)).toBe(true)
          expect(paths.has(notes)).toBe(true)
          expect(paths.has(resume)).toBe(false)
          expect(paths.has(path.join(dir, "HIRING-AGENTS.md"))).toBe(false)

          const rules = yield* svc.system()
          expect(rules).toContain(`Req materials from: ${jd}\n# Job Description`)
          expect(rules).toContain(`Req materials from: ${scorecard}\n# Scorecard`)
          expect(rules).toContain(`Req materials from: ${notes}\n# Notes`)
          expect(rules.some((rule) => rule.includes("resume"))).toBe(false)
        }),
    ),
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

  it.live("keeps HIRING-AGENTS.md alongside req materials", () =>
    withFiles(
      {
        "HIRING-AGENTS.md": "# Hiring norms",
        ".moks/req/jd.md": "# JD",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const agents = path.join(dir, "HIRING-AGENTS.md")
          const jd = path.join(dir, ".moks", "req", "jd.md")

          const paths = yield* svc.systemPaths()
          expect(paths.has(agents)).toBe(true)
          expect(paths.has(jd)).toBe(true)

          const rules = yield* svc.system()
          expect(rules).toContain(`Instructions from: ${agents}\n# Hiring norms`)
          expect(rules).toContain(`Req materials from: ${jd}\n# JD`)
        }),
    ),
  )

  it.live("uses nearest .moks/req when walking up from a nested directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* writeFiles(dir, {
        ".moks/req/jd.md": "# Root JD",
        "nested/.moks/req/jd.md": "# Nested JD",
        "nested/work/file.txt": "x",
      })
      const nested = path.join(dir, "nested", "work")

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(dir, "nested", ".moks", "req", "jd.md"))).toBe(true)
        expect(paths.has(path.join(dir, ".moks", "req", "jd.md"))).toBe(false)
      }).pipe(provideInstance(nested), provideInstruction({ home: dir, config: dir }))
    }),
  )

  it.live("truncates large req materials and skips empty ones", () =>
    withFiles(
      {
        ".moks/req/jd.md": "J".repeat(32_001),
        ".moks/req/scorecard.md": "",
        ".moks/req/notes.md": "# short notes",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const jd = path.join(dir, ".moks", "req", "jd.md")
          const scorecard = path.join(dir, ".moks", "req", "scorecard.md")
          const notes = path.join(dir, ".moks", "req", "notes.md")

          const paths = yield* svc.systemPaths()
          expect(paths.has(jd)).toBe(true)
          expect(paths.has(scorecard)).toBe(true)
          expect(paths.has(notes)).toBe(true)

          const rules = yield* svc.system()
          const jdRule = rules.find((rule) => rule.includes(jd))
          expect(jdRule).toBeDefined()
          expect(jdRule!.startsWith(`Req materials from: ${jd}\n`)).toBe(true)
          expect(jdRule!.includes("[truncated: file exceeds 32000 characters; use the read tool for full content]")).toBe(
            true,
          )
          expect(jdRule!.length).toBeLessThan(32_001 + 200)
          expect(rules.some((rule) => rule.includes(scorecard))).toBe(false)
          expect(rules).toContain(`Req materials from: ${notes}\n# short notes`)
        }),
    ),
  )

  it.live("attaches the only book req at the worktree root", () =>
    withFiles(
      {
        ".moks/reqs/senior-backend/jd.md": "# Senior Backend",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const jd = path.join(dir, ".moks", "reqs", "senior-backend", "jd.md")
          const paths = yield* svc.systemPaths()
          expect(paths.has(jd)).toBe(true)
        }),
    ),
  )

  it.live("does not attach every book req when several exist", () =>
    withFiles(
      {
        ".moks/reqs/senior-backend/jd.md": "# Senior Backend",
        ".moks/reqs/staff-ml/jd.md": "# Staff ML",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const paths = yield* svc.systemPaths()
          expect(paths.has(path.join(dir, ".moks", "reqs", "senior-backend", "jd.md"))).toBe(false)
          expect(paths.has(path.join(dir, ".moks", "reqs", "staff-ml", "jd.md"))).toBe(false)
        }),
    ),
  )

  it.live("attaches the last @slug mention when several book reqs exist", () =>
    withFiles(
      {
        ".moks/reqs/senior-backend/jd.md": "# Senior Backend",
        ".moks/reqs/senior-backend/scorecard.md": "# Senior scorecard",
        ".moks/reqs/staff-ml/jd.md": "# Staff ML",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const paths = yield* svc.systemPaths([mentioned(dir, "senior-backend")])
          expect(paths.has(path.join(dir, ".moks", "reqs", "senior-backend", "jd.md"))).toBe(true)
          expect(paths.has(path.join(dir, ".moks", "reqs", "senior-backend", "scorecard.md"))).toBe(true)
          expect(paths.has(path.join(dir, ".moks", "reqs", "staff-ml", "jd.md"))).toBe(false)
        }),
    ),
  )

  it.live("last @slug mention wins over an earlier one", () =>
    withFiles(
      {
        ".moks/reqs/senior-backend/jd.md": "# Senior Backend",
        ".moks/reqs/staff-ml/jd.md": "# Staff ML",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const paths = yield* svc.systemPaths([
            mentioned(dir, "senior-backend", undefined, "1"),
            mentioned(dir, "staff-ml", undefined, "2"),
          ])
          expect(paths.has(path.join(dir, ".moks", "reqs", "staff-ml", "jd.md"))).toBe(true)
          expect(paths.has(path.join(dir, ".moks", "reqs", "senior-backend", "jd.md"))).toBe(false)
        }),
    ),
  )

  it.live("legacy @req mention focuses .moks/req not a fake book slug", () =>
    withFiles(
      {
        ".moks/req/jd.md": "# Legacy JD",
        ".moks/reqs/req/jd.md": "# Fake book",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const paths = yield* svc.systemPaths([mentioned(dir, "req", path.join(".moks", "req"), "legacy")])
          expect(paths.has(path.join(dir, ".moks", "req", "jd.md"))).toBe(true)
          expect(paths.has(path.join(dir, ".moks", "reqs", "req", "jd.md"))).toBe(false)
        }),
    ),
  )

  it.live("attaches the book req that contains cwd", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* writeFiles(dir, {
        ".moks/reqs/senior-backend/jd.md": "# Senior Backend",
        ".moks/reqs/staff-ml/jd.md": "# Staff ML",
        ".moks/reqs/staff-ml/scores/keep.txt": "x",
      })
      const nested = path.join(dir, ".moks", "reqs", "staff-ml", "scores")

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(dir, ".moks", "reqs", "staff-ml", "jd.md"))).toBe(true)
        expect(paths.has(path.join(dir, ".moks", "reqs", "senior-backend", "jd.md"))).toBe(false)
      }).pipe(provideInstance(nested), provideInstruction({ home: dir, config: dir }))
    }),
  )
})

describe("Instruction.systemPaths global config", () => {
  it.live("uses Global.Service config HIRING-AGENTS.md", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "HIRING-AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, "HIRING-AGENTS.md"))).toBe(true)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )
})
