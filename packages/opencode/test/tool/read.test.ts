import { describe, expect, test } from "bun:test"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

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

describe("tool.read granular permission patterns", () => {
  test("still reads file content correctly with new permission patterns", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "index.ts"), "export const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "src", "index.ts") }, ctx)
        expect(result.output).toContain("export const x = 1")
      },
    })
  })

  test("asks with relative path pattern for files inside project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "index.ts"), "export const x = 1")
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
        await read.execute({ filePath: path.join(tmp.path, "src", "index.ts") }, testCtx)
        const readReq = requests.find((r) => r.permission === "read")
        expect(readReq).toBeDefined()
        expect(readReq!.patterns[0].endsWith("src/index.ts")).toBe(true)
      },
    })
  })

  test("uses extension-based always pattern for files with extensions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "config.json"), "{}")
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
        await read.execute({ filePath: path.join(tmp.path, "config.json") }, testCtx)
        const readReq = requests.find((r) => r.permission === "read")
        expect(readReq).toBeDefined()
        expect(readReq!.always).toEqual(["*.json"])
      },
    })
  })

  test("uses relative path as always pattern for files without extensions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "Makefile"), "all:\n\techo hello")
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
        await read.execute({ filePath: path.join(tmp.path, "Makefile") }, testCtx)
        const readReq = requests.find((r) => r.permission === "read")
        expect(readReq).toBeDefined()
        expect(readReq!.always[0].endsWith("Makefile")).toBe(true)
      },
    })
  })

  test("uses correct extension for dotfiles with extensions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".eslintrc.json"), "{}")
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
        await read.execute({ filePath: path.join(tmp.path, ".eslintrc.json") }, testCtx)
        const readReq = requests.find((r) => r.permission === "read")
        expect(readReq).toBeDefined()
        expect(readReq!.always).toEqual(["*.json"])
      },
    })
  })
})

describe("tool.read permission deny", () => {
  test("throws DeniedError when file pattern is denied", async () => {
    const { PermissionNext: PN } = await import("../../src/permission/next")
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secret.txt"), "secret content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            const rule = PN.evaluate(req.permission, req.patterns[0], [
              { permission: "read", pattern: "*secret.txt", action: "deny" },
            ])
            if (rule.action === "deny") {
              throw new PN.DeniedError([])
            }
          },
        }
        await expect(read.execute({ filePath: path.join(tmp.path, "secret.txt") }, testCtx)).rejects.toBeInstanceOf(
          PN.DeniedError,
        )
      },
    })
  })

  test("allows reading when file pattern matches allow rule", async () => {
    const { PermissionNext: PN } = await import("../../src/permission/next")
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "allowed.ts"), "export const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            const rule = PN.evaluate(req.permission, req.patterns[0], [
              { permission: "read", pattern: "*.ts", action: "allow" },
            ])
            if (rule.action === "deny") {
              throw new PN.DeniedError([])
            }
          },
        }
        const result = await read.execute({ filePath: path.join(tmp.path, "allowed.ts") }, testCtx)
        expect(result.output).toContain("export const x = 1")
      },
    })
  })
})

describe("tool.read env file blocking", () => {
  test.each([
    [".env", true],
    [".env.local", true],
    [".env.production", true],
    [".env.sample", false],
    [".env.example", false],
    [".envrc", false],
    ["environment.ts", false],
  ])("%s blocked=%s", async (filename, blocked) => {
    await using tmp = await tmpdir({
      init: (dir) => Bun.write(path.join(dir, filename), "content"),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const promise = read.execute({ filePath: path.join(tmp.path, filename) }, ctx)
        if (blocked) {
          await expect(promise).rejects.toThrow("blocked")
        } else {
          expect((await promise).output).toContain("content")
        }
      },
    })
  })
})
