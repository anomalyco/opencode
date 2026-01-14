import { describe, expect, test } from "bun:test"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { PermissionNext } from "../../src/permission/next"
import { Agent } from "../../src/agent/agent"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.read external_directory permission", () => {
  test("allows reading absolute path inside project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        expect(result.output).toContain("hello world")
      },
    })
  })

  test("allows reading file in subdirectory inside project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "test.txt"), "nested content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "subdir", "test.txt") }, ctx)
        expect(result.output).toContain("nested content")
      },
    })
  })

  test("asks for external_directory permission when reading absolute path outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secret.txt"), "secret data")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(outerTmp.path, "secret.txt") }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns.some((p) => p.includes(outerTmp.path))).toBe(true)
      },
    })
  })

  test("asks for external_directory permission when reading relative path outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        // This will fail because file doesn't exist, but we can check if permission was asked
        await read.execute({ filePath: "../outside.txt" }, testCtx).catch(() => {})
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("does not ask for external_directory permission when reading inside project", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "internal.txt"), "internal content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(tmp.path, "internal.txt") }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })
})

describe("tool.read env file permissions", () => {
  const cases: [string, boolean][] = [
    [".env", true],
    [".env.local", true],
    [".env.production", true],
    [".env.development.local", true],
    [".env.example", false],
    [".envrc", false],
    ["environment.ts", false],
  ]

  describe.each(["build", "plan"])("agent=%s", (agentName) => {
    test.each(cases)("%s asks=%s", async (filename, shouldAsk) => {
      await using tmp = await tmpdir({
        init: (dir) => Bun.write(path.join(dir, filename), "content"),
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const agent = await Agent.get(agentName)
          let askedForEnv = false
          const ctxWithPermissions = {
            ...ctx,
            ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
              for (const pattern of req.patterns) {
                const rule = PermissionNext.evaluate(req.permission, pattern, agent.permission)
                if (rule.action === "ask" && req.permission === "read") {
                  askedForEnv = true
                }
                if (rule.action === "deny") {
                  throw new PermissionNext.DeniedError(agent.permission)
                }
              }
            },
          }
          const read = await ReadTool.init()
          await read.execute({ filePath: path.join(tmp.path, filename) }, ctxWithPermissions)
          expect(askedForEnv).toBe(shouldAsk)
        },
      })
    })
  })
})

describe("tool.read truncation", () => {
  test("truncates large file by bytes and sets truncated metadata", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const content = await Bun.file(path.join(FIXTURES_DIR, "models-api.json")).text()
        await Bun.write(path.join(dir, "large.json"), content)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "large.json") }, ctx)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("Output truncated at")
        expect(result.output).toContain("bytes")
      },
    })
  })

  test("truncates by line count when limit is specified", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        await Bun.write(path.join(dir, "many-lines.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "many-lines.txt"), limit: 10 }, ctx)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("File has more lines")
        expect(result.output).toContain("line0")
        expect(result.output).toContain("line9")
        expect(result.output).not.toContain("line10")
      },
    })
  })

  test("does not truncate small file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "small.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "small.txt") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).toContain("End of file")
      },
    })
  })

  test("respects offset parameter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")
        await Bun.write(path.join(dir, "offset.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "offset.txt"), offset: 10, limit: 5 }, ctx)
        expect(result.output).toContain("line10")
        expect(result.output).toContain("line14")
        expect(result.output).not.toContain("line0")
        expect(result.output).not.toContain("line15")
      },
    })
  })

  test("truncates long lines", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const longLine = "x".repeat(3000)
        await Bun.write(path.join(dir, "long-line.txt"), longLine)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "long-line.txt") }, ctx)
        expect(result.output).toContain("...")
        expect(result.output.length).toBeLessThan(3000)
      },
    })
  })

  test("image files set truncated to false", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // 1x1 red PNG
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
          "base64",
        )
        await Bun.write(path.join(dir, "image.png"), png)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "image.png") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
      },
    })
  })

  test("large image files are properly attached without error", async () => {
    await Instance.provide({
      directory: FIXTURES_DIR,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(FIXTURES_DIR, "large-image.png") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0].type).toBe("file")
      },
    })
  })
})
