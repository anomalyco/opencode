import { describe, expect, test } from "bun:test"
import path from "path"
import { GrepTool } from "../../src/tool/grep"
import { Instance } from "../../src/project/instance"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const grep = await GrepTool.init()
const projectRoot = path.join(__dirname, "../..")

describe("tool.grep", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await grep.execute(
          {
            pattern: "GrepTool",
            path: path.join(projectRoot, "src/tool"),
            include: "*.ts",
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
        expect(result.output).toContain("GrepTool")
      },
    })
  })

  test("negative timeout throws error", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(
          grep.execute(
            {
              pattern: "test",
              timeout: -1,
            },
            ctx,
          ),
        ).rejects.toThrow("Invalid timeout value: -1. Timeout must be a positive number.")
      },
    })
  })

  test("timeout parameter", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await grep.execute(
          {
            pattern: "GrepTool",
            path: path.join(projectRoot, "src/tool"),
            include: "*.ts",
            timeout: 30000,
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
      },
    })
  })

  test("no matches", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await grep.execute(
          {
            pattern: "thisPatternShouldNeverMatchAnything12345",
            path: path.join(projectRoot, "src/tool"),
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      },
    })
  })
})
