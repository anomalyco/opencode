import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { WriteTaskTool } from "../../src/tool/write-task"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.write-task", () => {
  test("creates new task README with basic data", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()
        const result = await tool.execute(
          {
            feature: "1-user-auth",
            status: "in_progress",
            summary: "Initial setup for user authentication",
          },
          ctx,
        )

        expect(result.metadata.feature).toBe("1-user-auth")
        expect(result.metadata.featureName).toBe("User Auth")
        expect(result.metadata.status).toBe("in_progress")

        // Verify file was created
        const readmePath = path.join(tmp.path, ".starfleet", "tasks", "1-user-auth", "README.md")
        const content = await fs.readFile(readmePath, "utf-8")
        expect(content).toContain("# User Auth")
        expect(content).toContain("## Status")
        expect(content).toContain("in_progress")
        expect(content).toContain("Initial setup for user authentication")
      },
    })
  })

  test("creates task with todo items", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()
        await tool.execute(
          {
            feature: "2-dashboard",
            todo: [
              { task: "Create dashboard layout", done: false },
              { task: "Add navigation", done: true },
            ],
          },
          ctx,
        )

        const readmePath = path.join(tmp.path, ".starfleet", "tasks", "2-dashboard", "README.md")
        const content = await fs.readFile(readmePath, "utf-8")
        expect(content).toContain("- [ ] Create dashboard layout")
        expect(content).toContain("- [x] Add navigation")
      },
    })
  })

  test("merges todo items on update", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()

        // Create initial task
        await tool.execute(
          {
            feature: "3-settings",
            todo: [
              { task: "Create settings page", done: false },
              { task: "Add theme toggle", done: false },
            ],
          },
          ctx,
        )

        // Update with new and modified todos
        await tool.execute(
          {
            feature: "3-settings",
            todo: [
              { task: "Create settings page", done: true }, // Mark as done
              { task: "Add notification settings", done: false }, // New task
            ],
          },
          ctx,
        )

        const readmePath = path.join(tmp.path, ".starfleet", "tasks", "3-settings", "README.md")
        const content = await fs.readFile(readmePath, "utf-8")
        expect(content).toContain("- [x] Create settings page") // Updated
        expect(content).toContain("- [ ] Add theme toggle") // Preserved
        expect(content).toContain("- [ ] Add notification settings") // New
      },
    })
  })

  test("appends failures without duplicates", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()

        await tool.execute(
          {
            feature: "4-api",
            failures: ["API timeout error", "Invalid response format"],
          },
          ctx,
        )

        await tool.execute(
          {
            feature: "4-api",
            failures: ["API timeout error", "New error message"], // First is duplicate
          },
          ctx,
        )

        const readmePath = path.join(tmp.path, ".starfleet", "tasks", "4-api", "README.md")
        const content = await fs.readFile(readmePath, "utf-8")

        // Count occurrences of "API timeout error"
        const matches = content.match(/API timeout error/g)
        expect(matches?.length).toBe(1)
        expect(content).toContain("Invalid response format")
        expect(content).toContain("New error message")
      },
    })
  })

  test("appends changes without duplicates", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()

        await tool.execute(
          {
            feature: "5-refactor",
            changes: ["src/utils.ts", "src/helpers.ts"],
          },
          ctx,
        )

        await tool.execute(
          {
            feature: "5-refactor",
            changes: ["src/utils.ts", "src/new-file.ts"], // First is duplicate
          },
          ctx,
        )

        const readmePath = path.join(tmp.path, ".starfleet", "tasks", "5-refactor", "README.md")
        const content = await fs.readFile(readmePath, "utf-8")

        // Count occurrences of "src/utils.ts"
        const matches = content.match(/src\/utils\.ts/g)
        expect(matches?.length).toBe(1)
        expect(content).toContain("`src/helpers.ts`")
        expect(content).toContain("`src/new-file.ts`")
      },
    })
  })

  test("replaces next steps on update", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()

        await tool.execute(
          {
            feature: "6-testing",
            nextSteps: ["Write unit tests", "Write integration tests"],
          },
          ctx,
        )

        await tool.execute(
          {
            feature: "6-testing",
            nextSteps: ["Deploy to staging"], // Completely replace
          },
          ctx,
        )

        const readmePath = path.join(tmp.path, ".starfleet", "tasks", "6-testing", "README.md")
        const content = await fs.readFile(readmePath, "utf-8")
        expect(content).not.toContain("Write unit tests")
        expect(content).not.toContain("Write integration tests")
        expect(content).toContain("Deploy to staging")
      },
    })
  })

  test("status overwrites on update", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()

        await tool.execute(
          {
            feature: "7-migration",
            status: "in_progress",
          },
          ctx,
        )

        await tool.execute(
          {
            feature: "7-migration",
            status: "completed",
          },
          ctx,
        )

        const readmePath = path.join(tmp.path, ".starfleet", "tasks", "7-migration", "README.md")
        const content = await fs.readFile(readmePath, "utf-8")
        expect(content).toContain("completed")
        expect(content).not.toMatch(/in_progress/)
      },
    })
  })

  test("formats feature name correctly", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()
        const result = await tool.execute(
          {
            feature: "10-multi-word-feature-name",
            status: "in_progress",
          },
          ctx,
        )

        expect(result.metadata.featureName).toBe("Multi Word Feature Name")

        const readmePath = path.join(
          tmp.path,
          ".starfleet",
          "tasks",
          "10-multi-word-feature-name",
          "README.md",
        )
        const content = await fs.readFile(readmePath, "utf-8")
        expect(content).toContain("# Multi Word Feature Name")
      },
    })
  })

  test("appends summary with timestamp separator", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()

        await tool.execute(
          {
            feature: "8-summary-test",
            summary: "First summary entry",
          },
          ctx,
        )

        await tool.execute(
          {
            feature: "8-summary-test",
            summary: "Second summary entry",
          },
          ctx,
        )

        const readmePath = path.join(tmp.path, ".starfleet", "tasks", "8-summary-test", "README.md")
        const content = await fs.readFile(readmePath, "utf-8")
        expect(content).toContain("First summary entry")
        expect(content).toContain("Second summary entry")
        expect(content).toContain("---")
        expect(content).toContain("*Updated:")
      },
    })
  })

  test("handles blocked status", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WriteTaskTool.init()
        const result = await tool.execute(
          {
            feature: "9-blocked-feature",
            status: "blocked",
            failures: ["Waiting for external API access"],
          },
          ctx,
        )

        expect(result.metadata.status).toBe("blocked")

        const readmePath = path.join(
          tmp.path,
          ".starfleet",
          "tasks",
          "9-blocked-feature",
          "README.md",
        )
        const content = await fs.readFile(readmePath, "utf-8")
        expect(content).toContain("blocked")
        expect(content).toContain("Waiting for external API access")
      },
    })
  })
})
