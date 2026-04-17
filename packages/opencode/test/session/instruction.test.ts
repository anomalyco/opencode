import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instruction } from "../../src/session/instruction"
import type { MessageV2 } from "../../src/session/message-v2"
import { Instance } from "../../src/project/instance"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

const run = <A>(effect: Effect.Effect<A, any, Instruction.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Instruction.defaultLayer)))

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
  test("returns empty when AGENTS.md is at project root (already in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Root Instructions")
        await Bun.write(path.join(dir, "src", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Instruction.Service.use((svc) =>
            Effect.gen(function* () {
              const system = yield* svc.systemPaths()
              expect(system.has(path.join(tmp.path, "AGENTS.md"))).toBe(true)

              const results = yield* svc.resolve(
                [],
                path.join(tmp.path, "src", "file.ts"),
                MessageID.make("message-test-1"),
              )
              expect(results).toEqual([])
            }),
          ),
        ),
    })
  })

  test("returns AGENTS.md from subdirectory (not in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Instruction.Service.use((svc) =>
            Effect.gen(function* () {
              const system = yield* svc.systemPaths()
              expect(system.has(path.join(tmp.path, "subdir", "AGENTS.md"))).toBe(false)

              const results = yield* svc.resolve(
                [],
                path.join(tmp.path, "subdir", "nested", "file.ts"),
                MessageID.make("message-test-2"),
              )
              expect(results.length).toBe(1)
              expect(results[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
            }),
          ),
        ),
    })
  })

  test("doesn't reload AGENTS.md when reading it directly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Instruction.Service.use((svc) =>
            Effect.gen(function* () {
              const filepath = path.join(tmp.path, "subdir", "AGENTS.md")
              const system = yield* svc.systemPaths()
              expect(system.has(filepath)).toBe(false)

              const results = yield* svc.resolve([], filepath, MessageID.make("message-test-3"))
              expect(results).toEqual([])
            }),
          ),
        ),
    })
  })

  test("does not reattach the same nearby instructions twice for one message", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Instruction.Service.use((svc) =>
            Effect.gen(function* () {
              const filepath = path.join(tmp.path, "subdir", "nested", "file.ts")
              const id = MessageID.make("message-claim-1")

              const first = yield* svc.resolve([], filepath, id)
              const second = yield* svc.resolve([], filepath, id)

              expect(first).toHaveLength(1)
              expect(first[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
              expect(second).toEqual([])
            }),
          ),
        ),
    })
  })

  test("clear allows nearby instructions to be attached again for the same message", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Instruction.Service.use((svc) =>
            Effect.gen(function* () {
              const filepath = path.join(tmp.path, "subdir", "nested", "file.ts")
              const id = MessageID.make("message-claim-2")

              const first = yield* svc.resolve([], filepath, id)
              yield* svc.clear(id)
              const second = yield* svc.resolve([], filepath, id)

              expect(first).toHaveLength(1)
              expect(second).toHaveLength(1)
              expect(second[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
            }),
          ),
        ),
    })
  })

  test("skips instructions already reported by prior read metadata", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Instruction.Service.use((svc) =>
            Effect.gen(function* () {
              const agents = path.join(tmp.path, "subdir", "AGENTS.md")
              const filepath = path.join(tmp.path, "subdir", "nested", "file.ts")
              const id = MessageID.make("message-claim-3")

              const results = yield* svc.resolve(loaded(agents), filepath, id)
              expect(results).toEqual([])
            }),
          ),
        ),
    })
  })

  test.todo("fetches remote instructions from config URLs via HttpClient", () => {})
})

describe("Instruction.system", () => {
  test("loads both project and global AGENTS.md when both exist", async () => {
    const originalConfigDir = process.env["OPENCODE_CONFIG_DIR"]
    delete process.env["OPENCODE_CONFIG_DIR"]

    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Project Instructions")
      },
    })

    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: () =>
          run(
            Instruction.Service.use((svc) =>
              Effect.gen(function* () {
                const paths = yield* svc.systemPaths()
                expect(paths.has(path.join(projectTmp.path, "AGENTS.md"))).toBe(true)
                expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)

                const rules = yield* svc.system()
                expect(rules).toHaveLength(2)
                expect(rules).toContain(
                  `Instructions from: ${path.join(projectTmp.path, "AGENTS.md")}\n# Project Instructions`,
                )
                expect(rules).toContain(
                  `Instructions from: ${path.join(globalTmp.path, "AGENTS.md")}\n# Global Instructions`,
                )
              }),
            ),
          ),
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
      if (originalConfigDir === undefined) {
        delete process.env["OPENCODE_CONFIG_DIR"]
      } else {
        process.env["OPENCODE_CONFIG_DIR"] = originalConfigDir
      }
    }
  })
})

describe("Instruction.systemPaths OPENCODE_CONFIG_DIR", () => {
  let originalConfigDir: string | undefined

  beforeEach(() => {
    originalConfigDir = process.env["OPENCODE_CONFIG_DIR"]
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env["OPENCODE_CONFIG_DIR"]
    } else {
      process.env["OPENCODE_CONFIG_DIR"] = originalConfigDir
    }
  })

  test("prefers OPENCODE_CONFIG_DIR AGENTS.md over global when both exist", async () => {
    await using profileTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Profile Instructions")
      },
    })
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env["OPENCODE_CONFIG_DIR"] = profileTmp.path
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: () =>
          run(
            Instruction.Service.use((svc) =>
              Effect.gen(function* () {
                const paths = yield* svc.systemPaths()
                expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(true)
                expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(false)
              }),
            ),
          ),
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  test("falls back to global AGENTS.md when OPENCODE_CONFIG_DIR has no AGENTS.md", async () => {
    await using profileTmp = await tmpdir()
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env["OPENCODE_CONFIG_DIR"] = profileTmp.path
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: () =>
          run(
            Instruction.Service.use((svc) =>
              Effect.gen(function* () {
                const paths = yield* svc.systemPaths()
                expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(false)
                expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
              }),
            ),
          ),
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  test("uses global AGENTS.md when OPENCODE_CONFIG_DIR is not set", async () => {
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    delete process.env["OPENCODE_CONFIG_DIR"]
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: () =>
          run(
            Instruction.Service.use((svc) =>
              Effect.gen(function* () {
                const paths = yield* svc.systemPaths()
                expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
              }),
            ),
          ),
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })
})
