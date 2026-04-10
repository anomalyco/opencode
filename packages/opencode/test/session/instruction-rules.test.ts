import { describe, expect, test } from "bun:test"
import path from "path"
import { Instruction } from "../../src/session/instruction"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

describe("Instruction.systemPaths rules loading", () => {
  test("loads *.md files from global rules directory", async () => {
    await using homeTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".opencode", "rules", "style.md"), "# Style Rules")
        await Bun.write(path.join(dir, ".opencode", "rules", "security.md"), "# Security Rules")
      },
    })
    await using projectTmp = await tmpdir()

    const originalHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = homeTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await Instruction.systemPaths()
          expect(paths.has(path.join(homeTmp.path, ".opencode", "rules", "style.md"))).toBe(true)
          expect(paths.has(path.join(homeTmp.path, ".opencode", "rules", "security.md"))).toBe(true)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = originalHome
    }
  })

  test("loads *.md files from project rules directory", async () => {
    await using homeTmp = await tmpdir()
    await using projectTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".opencode", "rules", "local.md"), "# Local Rules")
      },
    })

    const originalHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = homeTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await Instruction.systemPaths()
          expect(paths.has(path.join(projectTmp.path, ".opencode", "rules", "local.md"))).toBe(true)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = originalHome
    }
  })

  test("both global and project rules with same filename are loaded", async () => {
    await using homeTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".opencode", "rules", "style.md"), "# Global Style")
        await Bun.write(path.join(dir, ".opencode", "rules", "unique-global.md"), "# Unique Global")
      },
    })
    await using projectTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".opencode", "rules", "style.md"), "# Project Style")
      },
    })

    const originalHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = homeTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await Instruction.systemPaths()
          // Project style.md should be present
          expect(paths.has(path.join(projectTmp.path, ".opencode", "rules", "style.md"))).toBe(true)
          // Global style.md should also be present (both are loaded)
          expect(paths.has(path.join(homeTmp.path, ".opencode", "rules", "style.md"))).toBe(true)
          // Global unique-global.md should still be present
          expect(paths.has(path.join(homeTmp.path, ".opencode", "rules", "unique-global.md"))).toBe(true)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = originalHome
    }
  })

  test("missing rules directories do not cause errors", async () => {
    await using homeTmp = await tmpdir()
    await using projectTmp = await tmpdir()

    const originalHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = homeTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          // Should not throw even when neither rules dir exists
          const paths = await Instruction.systemPaths()
          expect(paths).toBeInstanceOf(Set)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = originalHome
    }
  })

  test("project rules are not loaded when OPENCODE_DISABLE_PROJECT_CONFIG is set", async () => {
    await using homeTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".opencode", "rules", "global.md"), "# Global Rule")
      },
    })
    await using projectTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".opencode", "rules", "malicious.md"), "# Malicious Rule")
      },
    })

    const originalHome = process.env.OPENCODE_TEST_HOME
    const originalDisable = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
    process.env.OPENCODE_TEST_HOME = homeTmp.path
    process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "true"

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await Instruction.systemPaths()
          // Global rules should still load
          expect(paths.has(path.join(homeTmp.path, ".opencode", "rules", "global.md"))).toBe(true)
          // Project rules must NOT load (trust boundary)
          expect(paths.has(path.join(projectTmp.path, ".opencode", "rules", "malicious.md"))).toBe(false)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = originalHome
      if (originalDisable === undefined) {
        delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
      } else {
        process.env.OPENCODE_DISABLE_PROJECT_CONFIG = originalDisable
      }
    }
  })

  test("non-.md files are not loaded from rules directories", async () => {
    await using homeTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".opencode", "rules", "valid.md"), "# Valid Rule")
        await Bun.write(path.join(dir, ".opencode", "rules", "ignored.txt"), "Not a rule")
        await Bun.write(path.join(dir, ".opencode", "rules", "ignored.json"), '{"not": "a rule"}')
      },
    })
    await using projectTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".opencode", "rules", "local.md"), "# Local Rule")
        await Bun.write(path.join(dir, ".opencode", "rules", "data.yaml"), "not: a rule")
      },
    })

    const originalHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = homeTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await Instruction.systemPaths()
          const allPaths = Array.from(paths)

          // .md files should be loaded
          expect(paths.has(path.join(homeTmp.path, ".opencode", "rules", "valid.md"))).toBe(true)
          expect(paths.has(path.join(projectTmp.path, ".opencode", "rules", "local.md"))).toBe(true)

          // non-.md files should NOT be loaded
          expect(allPaths.some((p) => p.endsWith("ignored.txt"))).toBe(false)
          expect(allPaths.some((p) => p.endsWith("ignored.json"))).toBe(false)
          expect(allPaths.some((p) => p.endsWith("data.yaml"))).toBe(false)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = originalHome
    }
  })
})
