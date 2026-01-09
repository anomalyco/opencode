import { test, expect, describe, beforeEach } from "bun:test"
import { Rules, type Rule } from "../../src/config/rules"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

describe("Rules", () => {
  test("sorts patterns by specificity", () => {
    const patterns = ["src/**/*.ts", "src/api/**/*.ts", "src/api/users.ts"]
    const rules: Rule[] = [
      {
        filePath: "/test/rules.md",
        paths: patterns,
        content: "test content",
      },
    ]
    const matched = Rules.matchRulesForFile(rules, "src/api/users.ts")
    expect(matched.length).toBe(1)
    expect(matched[0]).toBe("test content")
  })

  test("exclusion pattern removes matching rules", () => {
    const rules: Rule[] = [
      {
        filePath: "/test/test.md",
        paths: ["src/**/*.ts", "!src/__tests__/**/*.ts"],
        content: "Test rules",
      },
    ]
    expect(Rules.matchRulesForFile(rules, "src/utils.ts")).toContain("Test rules")
    expect(Rules.matchRulesForFile(rules, "src/__tests__/utils.test.ts")).not.toContain("Test rules")
  })

  describe("loadForFile", () => {
    test("is disabled by default", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await fs.mkdir(path.join(dir, "src"), { recursive: true })
          await fs.writeFile(path.join(dir, "src", "AGENTS.md"), "Src Rules")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const rules = await Rules.loadForFile(path.join(tmp.path, "src", "main.ts"))
          expect(rules.length).toBe(0)
        },
      })
    })

    test("traverses up and collects subdirectory rules", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, "a", "b"), { recursive: true })
          await fs.writeFile(path.join(dir, "a", "AGENTS.md"), "A Rules")
          await fs.writeFile(path.join(dir, "a", "b", "AGENTS.md"), "B Rules")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ subdirectoryRules: { enabled: true } }) as any

          const rules = await Rules.loadForFile(path.join(tmp.path, "a", "b", "file.ts"))
          expect(rules.length).toBe(2)
          expect(rules[0].content).toBe("A Rules")
          expect(rules[1].content).toBe("B Rules")

          Config.get = originalGet
        },
      })
    })

    test("excludes project root LOCAL_RULE_FILES", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.writeFile(path.join(dir, "AGENTS.md"), "Root Rules")
          await fs.mkdir(path.join(dir, "src"), { recursive: true })
          await fs.writeFile(path.join(dir, "src", "AGENTS.md"), "Src Rules")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ subdirectoryRules: { enabled: true } }) as any

          const rules = await Rules.loadForFile(path.join(tmp.path, "src", "main.ts"))
          // Should only contain src/AGENTS.md, root AGENTS.md is excluded
          expect(rules.length).toBe(1)
          expect(rules[0].content).toBe("Src Rules")

          Config.get = originalGet
        },
      })
    })

    test("exact: true only loads from current directory", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, "a", "b"), { recursive: true })
          await fs.writeFile(path.join(dir, "a", "AGENTS.md"), "A Rules")
          await fs.writeFile(path.join(dir, "a", "b", "AGENTS.md"), "B Rules")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ subdirectoryRules: { enabled: true, exact: true } }) as any

          const rules = await Rules.loadForFile(path.join(tmp.path, "a", "b", "file.ts"))
          expect(rules.length).toBe(1)
          expect(rules[0].content).toBe("B Rules")

          Config.get = originalGet
        },
      })
    })

    test("supports custom glob patterns", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.mkdir(path.join(dir, "src"), { recursive: true })
          await fs.writeFile(path.join(dir, "src", "test.custom.md"), "Custom Rule")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () =>
            ({
              subdirectoryRules: { enabled: true, patterns: ["**/*.custom.md"] },
            }) as any

          const rules = await Rules.loadForFile(path.join(tmp.path, "src", "file.ts"))
          expect(rules.length).toBe(1)
          expect(rules[0].content).toBe("Custom Rule")

          Config.get = originalGet
        },
      })
    })
  })
})
