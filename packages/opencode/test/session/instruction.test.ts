import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import path from "path"
import { Cause, Effect, Exit, FileSystem, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

import { Instruction } from "../../src/session/instruction"
import { InstructionAudience } from "../../src/session/instruction-audience"
import type { MessageV2 } from "../../src/session/message-v2"
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
const mainBuild: InstructionAudience.Reader = { role: "main", agent: "build" }

const instructionLayer = (
  global: Partial<Global.Interface>,
  flags: Partial<RuntimeFlags.Info> = {},
  config: Config.Interface = TestConfig.make(),
) =>
  AppNodeBuilder.build(Instruction.node, [
    [Config.node, Layer.succeed(Config.Service, config)],
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
  it.live("returns empty when AGENTS.md is at project root (already in systemPaths)", () =>
    withFiles({ "AGENTS.md": "# Root Instructions", "src/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "AGENTS.md"))).toBe(true)

        const results = yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_message-test-1"), mainBuild)
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
          MessageID.make("msg_message-test-2"),
          mainBuild,
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

        const results = yield* svc.resolve([], filepath, MessageID.make("msg_message-test-3"), mainBuild)
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("does not reattach the same nearby instructions twice for one message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-1")

        const first = yield* svc.resolve([], filepath, id, mainBuild)
        const second = yield* svc.resolve([], filepath, id, mainBuild)

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
        const id = MessageID.make("msg_message-claim-2")

        const first = yield* svc.resolve([], filepath, id, mainBuild)
        yield* svc.clear(id)
        const second = yield* svc.resolve([], filepath, id, mainBuild)

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
        const id = MessageID.make("msg_message-claim-3")

        const results = yield* svc.resolve(loaded(agents), filepath, id, mainBuild)
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("a child reader cannot resolve a nested AGENTS.md marked audience: main", () =>
    withFiles(
      {
        "subdir/AGENTS.md": "---\nopencode:\n  audience: main\n---\nMAIN-ONLY NESTED DOCTRINE\n",
        "subdir/nested/file.ts": "const x = 1",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const results = yield* svc.resolve(
            [],
            path.join(dir, "subdir", "nested", "file.ts"),
            MessageID.make("msg_message-claim-audience"),
            { role: "subagent", agent: "build" },
          )
          expect(results).toEqual([])
        }),
    ),
  )

  it.live("a matching nested instruction is included with frontmatter stripped", () =>
    withFiles(
      {
        "subdir/AGENTS.md": "---\nopencode:\n  audience: main\n---\nMAIN-ONLY NESTED DOCTRINE\n",
        "subdir/nested/file.ts": "const x = 1",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const results = yield* svc.resolve(
            [],
            path.join(dir, "subdir", "nested", "file.ts"),
            MessageID.make("msg_message-audience-main"),
            mainBuild,
          )
          expect(results).toHaveLength(1)
          expect(results[0].content).toContain("MAIN-ONLY NESTED DOCTRINE")
          expect(results[0].content).not.toContain("audience: main")
        }),
    ),
  )

  it.live("delivers malformed audience as a typed failure rather than a defect", () =>
    withFiles(
      {
        "subdir/AGENTS.md": "---\nopencode:\n  audiance: main\n---\nBody\n",
        "subdir/nested/file.ts": "const x = 1",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const exit = yield* svc.resolve(
            [],
            path.join(dir, "subdir", "nested", "file.ts"),
            MessageID.make("msg_message-audience-typed-failure"),
            mainBuild,
          ).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isSuccess(exit)) return
          expect(Cause.hasDies(exit.cause)).toBe(false)
          expect(Cause.hasFails(exit.cause)).toBe(true)
          expect(Cause.squash(exit.cause)).toBeInstanceOf(InstructionAudience.AudienceError)
        }),
    ),
  )

  it.live("a malformed nested audience directive fails with its path", () =>
    withFiles(
      {
        "subdir/AGENTS.md": "---\nopencode:\n  audiance: main\n---\nBody\n",
        "subdir/nested/file.ts": "const x = 1",
      },
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const filepath = path.join(dir, "subdir", "AGENTS.md")
          const exit = yield* svc.resolve(
            [],
            path.join(dir, "subdir", "nested", "file.ts"),
            MessageID.make("msg_message-audience-malformed"),
            mainBuild,
          ).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isSuccess(exit)) return
          const error = Cause.squash(exit.cause)
          expect(error).toBeInstanceOf(InstructionAudience.AudienceError)
          expect(String(error)).toContain(filepath)
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

        const rules = yield* svc.system(mainBuild)
        expect(rules).toHaveLength(2)
        expect(rules[0]).toBe(`Instructions from: ${path.join(globalTmp, "AGENTS.md")}\n# Global Instructions`)
        expect(rules[1]).toBe(`Instructions from: ${path.join(projectTmp, "AGENTS.md")}\n# Project Instructions`)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("origin and audience filters intersect independently", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({
        "CONFIG_MATCH.md": "---\nopencode:\n  audience:\n    - agent: build*\n---\nCONFIG MATCH\n",
      })
      const projectTmp = yield* tmpWithFiles({
        "AGENTS.md": "---\nopencode:\n  audience:\n    - agent: build*\n---\nPROJECT MATCH\n",
        "PROJECT_WRONG.md": "---\nopencode:\n  audience:\n    - agent: other*\n---\nPROJECT WRONG AUDIENCE\n",
      })
      const config = TestConfig.make({
        get: () => Effect.succeed({
          instructions: [path.join(projectTmp, "PROJECT_WRONG.md"), path.join(globalTmp, "CONFIG_MATCH.md")],
        }),
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const all = yield* svc.system(mainBuild)
        expect(all.join("\n")).toContain("PROJECT MATCH")
        expect(all.join("\n")).toContain("CONFIG MATCH")
        expect(all.join("\n")).not.toContain("PROJECT WRONG AUDIENCE")
      }).pipe(
        provideInstance(projectTmp),
        Effect.provide(instructionLayer({ home: globalTmp, config: globalTmp }, {}, config)),
      )
    }),
  )

  it.live("assembly preserves unrelated frontmatter and horizontal-rule bytes", () =>
    Effect.gen(function* () {
      const projectTmp = yield* tmpWithFiles({
        "AGENTS.md": "---\ntitle: A Document\n---\nBody\n",
        "RULE.md": "---\nA heading\n---\nBody text here\n",
      })
      const config = TestConfig.make({
        get: () => Effect.succeed({ instructions: [path.join(projectTmp, "RULE.md")] }),
      })
      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const rules = yield* svc.system(mainBuild)
        expect(rules).toContain(`Instructions from: ${path.join(projectTmp, "AGENTS.md")}\n---\ntitle: A Document\n---\nBody\n`)
        expect(rules).toContain(`Instructions from: ${path.join(projectTmp, "RULE.md")}\n---\nA heading\n---\nBody text here\n`)
      }).pipe(
        provideInstance(projectTmp),
        Effect.provide(instructionLayer({ home: projectTmp, config: projectTmp }, {}, config)),
      )
    }),
  )

  it.live("assembly strips a validated directive", () =>
    Effect.gen(function* () {
      const projectTmp = yield* tmpWithFiles({
        "AGENTS.md": "---\nopencode:\n  audience: main\n---\nBODY\n",
      })
      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const rules = yield* svc.system(mainBuild)
        expect(rules).toContain(`Instructions from: ${path.join(projectTmp, "AGENTS.md")}\nBODY\n`)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: projectTmp, config: projectTmp }))
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
        expect(yield* svc.system(mainBuild)).toEqual([])
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }, { disableClaudeCodePrompt: true }),
      )
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
