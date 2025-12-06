import { test, expect } from "bun:test"
import { Command } from "../../src/command/index"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

test("commands are cached by default (cache_command_markdown_files not set)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const commandDir = path.join(opencodeDir, "command")
      await fs.mkdir(commandDir, { recursive: true })

      await Bun.write(
        path.join(commandDir, "test.md"),
        `---
description: Original command
---
Original template`,
      )

      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const cmd1 = await Command.get("test")
      expect(cmd1?.template).toBe("Original template")

      // Modify the markdown file
      const commandFile = path.join(tmp.path, ".opencode", "command", "test.md")
      await Bun.write(
        commandFile,
        `---
description: Modified command
---
Modified template`,
      )

      // Should still return the cached version
      const cmd2 = await Command.get("test")
      expect(cmd2?.template).toBe("Original template")
    },
  })
})

test("commands reload when cache_command_markdown_files is false", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const commandDir = path.join(opencodeDir, "command")
      await fs.mkdir(commandDir, { recursive: true })

      await Bun.write(
        path.join(commandDir, "test.md"),
        `---
description: Original command
---
Original template`,
      )

      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          experimental: {
            cache_command_markdown_files: false,
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const cmd1 = await Command.get("test")
      expect(cmd1?.template).toBe("Original template")

      // Modify the markdown file
      const commandFile = path.join(tmp.path, ".opencode", "command", "test.md")
      await Bun.write(
        commandFile,
        `---
description: Modified command
---
Modified template`,
      )

      // Should return the fresh version
      const cmd2 = await Command.get("test")
      expect(cmd2?.template).toBe("Modified template")
    },
  })
})

test("built-in commands are always available regardless of cache setting", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          experimental: {
            cache_command_markdown_files: false,
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const init = await Command.get(Command.Default.INIT)
      expect(init?.name).toBe("init")
      expect(init?.description).toContain("AGENTS.md")

      const review = await Command.get(Command.Default.REVIEW)
      expect(review?.name).toBe("review")
      expect(review?.description).toContain("review changes")
    },
  })
})

test("Command.list() respects cache setting", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const commandDir = path.join(opencodeDir, "command")
      await fs.mkdir(commandDir, { recursive: true })

      await Bun.write(
        path.join(commandDir, "cmd1.md"),
        `---
description: Command 1
---
Template 1`,
      )

      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          experimental: {
            cache_command_markdown_files: false,
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const list1 = await Command.list()
      const hasCmd1 = list1.some((c) => c.name === "cmd1")
      expect(hasCmd1).toBe(true)

      // Add a new command file
      const commandDir = path.join(tmp.path, ".opencode", "command")
      await Bun.write(
        path.join(commandDir, "cmd2.md"),
        `---
description: Command 2
---
Template 2`,
      )

      // Should reflect the new command in the list
      const list2 = await Command.list()
      const hasCmd2 = list2.some((c) => c.name === "cmd2")
      expect(hasCmd2).toBe(true)
    },
  })
})

test("command descriptions and metadata are correctly loaded when cache_command_markdown_files is false", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const commandDir = path.join(opencodeDir, "command")
      await fs.mkdir(commandDir, { recursive: true })

      await Bun.write(
        path.join(commandDir, "test.md"),
        `---
description: Test command
agent: test_agent
model: test/model
subtask: true
---
Test template content`,
      )

      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          experimental: {
            cache_command_markdown_files: false,
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const cmd = await Command.get("test")
      expect(cmd?.name).toBe("test")
      expect(cmd?.description).toBe("Test command")
      expect(cmd?.agent).toBe("test_agent")
      expect(cmd?.model).toBe("test/model")
      expect(cmd?.subtask).toBe(true)
      expect(cmd?.template).toBe("Test template content")
    },
  })
})

test("nested command directories work correctly with dynamic reload", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const commandDir = path.join(opencodeDir, "command", "nested")
      await fs.mkdir(commandDir, { recursive: true })

      await Bun.write(
        path.join(commandDir, "test.md"),
        `---
description: Nested command
---
Nested template`,
      )

      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          experimental: {
            cache_command_markdown_files: false,
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const cmd = await Command.get("nested/test")
      expect(cmd?.name).toBe("nested/test")
      expect(cmd?.template).toBe("Nested template")
    },
  })
})
