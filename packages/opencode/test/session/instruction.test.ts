import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { InstructionPrompt } from "../../src/session/instruction"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("InstructionPrompt.resolve", () => {
  test("returns empty when AGENTS.md is at project root (already in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Root Instructions")
        await Bun.write(path.join(dir, "src", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "AGENTS.md"))).toBe(true)

        const results = await InstructionPrompt.resolve([], path.join(tmp.path, "src", "file.ts"), "test-message-1")
        expect(results).toEqual([])
      },
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
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "subdir", "AGENTS.md"))).toBe(false)

        const results = await InstructionPrompt.resolve(
          [],
          path.join(tmp.path, "subdir", "nested", "file.ts"),
          "test-message-2",
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
      },
    })
  })
})

describe("InstructionPrompt.system", () => {

  test("globbed instructions included in config are read", async () => {
    
    await using tmp = await tmpdir({ })

    // because of the way this loads, we need to override env:HOME and env:XDG_CONFIG_HOME
    const originalHome = process.env.OPENCODE_TEST_HOME
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME 
    console.debug(tmp.path)

    const projectDir = path.join(tmp.path, "project")
    const homeDir = path.join(tmp.path, "home")
    const opencodeDir = path.join(homeDir, ".config/opencode")

    process.env.OPENCODE_TEST_HOME = homeDir
    process.env.XDG_CONFIG_HOME = opencodeDir

    await fs.mkdir(opencodeDir, { recursive: true })

    // create a bunch of global instructions files and globs
    const instruction_paths = [
      "shared-rules.md",
      "instructions-flat/*.md",
      "instructions-nested/**/*.md",
      "instructions-match-1/{a,b,c}.md",
      "instructions-match-2/[fb]oo.md",
      "instructions-match-3/?oo.md",
      "instructions-match-4/!*.txt",
    ]
    const instruction_files = [
      "shared-rules.md",                              // no glob
      "instructions-flat/test-1.md",                  // ../*.md glob pattern
      "instructions-flat/test-2.md",                  // ../*.md glob pattern
      "instructions-nested/test-1/test.md",           // **/* glob pattern
      "instructions-nested/test-2/test/test.md",      // **/* glob pattern
      "instructions-match-1/a.md",                    // {a,b,c} glob pattern
      "instructions-match-1/b.md",                    // {a,b,c} glob pattern
      "instructions-match-1/c.md",                    // {a,b,c} glob pattern
      "instructions-match-1/d.md",                    // {a,b,c} glob pattern - should be false
      "instructions-match-2/foo.md",                  // [ab] glob pattern
      "instructions-match-2/boo.md",                  // [ab] glob pattern
      "instructions-match-2/bar.md",                  // [ab] glob pattern - should be false
      "instructions-match-3/foo.md",                  // ? glob pattern
      "instructions-match-3/boo.md",                  // ? glob pattern
      "instructions-match-3/bar.md",                  // ? glob pattern - should be false
      "instructions-match-4/test.md",                 // ! glob pattern
      "instructions-match-4/test.txt",                // ! glob pattern - should be false
    ]

    await Bun.write(
      path.join(opencodeDir, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        instructions: instruction_paths.map(p => path.join(opencodeDir, p)),
      }),
    )
    for (const item of instruction_files) { 
      await Bun.write(path.resolve(opencodeDir, item), item, {createPath: true})
    }

    try {
      await Instance.provide({
        directory: projectDir,
        fn: async () => {
          const system = await InstructionPrompt.systemPaths()
          expect(system.has(path.resolve(projectDir, "shared-rules.md"))).toBe(false)
          expect(system.has(path.resolve(opencodeDir, "instructions-flat", "test-1.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-flat", "test-2.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-nested", "test-1", "test.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-nested", "test-2", "test", "test.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-1", "a.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-1", "b.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-1", "c.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-1", "d.md"))).toBe(false)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-2", "foo.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-2", "boo.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-2", "bar.md"))).toBe(false)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-3", "foo.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-3", "boo.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-3", "bar.md"))).toBe(false)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-4", "test.md"))).toBe(true)
          expect(system.has(path.resolve(opencodeDir, "instructions-match-4", "test.txt"))).toBe(false)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = originalHome
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome
      await fs.rm(tmp.path, {recursive: true, force: true})
    }
   
  })
})

