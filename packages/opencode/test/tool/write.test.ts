import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { PermissionNext } from "../../src/permission/next"
import { FileTime } from "../../src/file/time"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.write external_directory permission", () => {
  test("allows writing to path inside project directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = await WriteTool.init()
        const result = await write.execute(
          { filePath: path.join(tmp.path, "new-file.txt"), content: "hello world" },
          ctx,
        )
        expect(result.title).toContain("new-file.txt")

        // Verify file was written
        const content = await Bun.file(path.join(tmp.path, "new-file.txt")).text()
        expect(content).toBe("hello world")
      },
    })
  })

  test("asks for external_directory permission when writing to path outside project", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = await WriteTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await write.execute(
          { filePath: path.join(outerTmp.path, "external.txt"), content: "external content" },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns.some((p) => p.includes(outerTmp.path))).toBe(true)
      },
    })
  })

  test("does not ask for external_directory permission when writing inside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = await WriteTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await write.execute({ filePath: path.join(tmp.path, "internal.txt"), content: "internal" }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })
})

describe("tool.write symlink protection", () => {
  test("asks for external_directory permission when writing to symlink pointing outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "target.txt"), "original content")
      },
    })
    await using tmp = await tmpdir({ git: true })

    // Create symlink inside project pointing to file outside
    const symlinkPath = path.join(tmp.path, "escape-link.txt")
    await $`ln -s ${path.join(outerTmp.path, "target.txt")} ${symlinkPath}`.quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Mark file as "read" to satisfy FileTime.assert
        FileTime.read(ctx.sessionID, symlinkPath)

        const write = await WriteTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await write.execute({ filePath: symlinkPath, content: "malicious content" }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("asks for external_directory permission when writing to broken symlink pointing outside", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create broken symlink pointing outside project
    const symlinkPath = path.join(tmp.path, "broken-escape.txt")
    await $`ln -s /tmp/nonexistent-target-outside ${symlinkPath}`.quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Mark file as "read" to satisfy FileTime.assert (broken symlink is treated as new file)
        FileTime.read(ctx.sessionID, symlinkPath)

        const write = await WriteTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await write.execute({ filePath: symlinkPath, content: "content" }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("does not ask for external_directory when writing to symlink pointing inside project", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "target.txt"), "original internal content")
      },
    })

    // Create symlink inside project pointing to file inside project
    const symlinkPath = path.join(tmp.path, "internal-link.txt")
    await $`ln -s ${path.join(tmp.path, "target.txt")} ${symlinkPath}`.quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Mark file as "read" to satisfy FileTime.assert
        FileTime.read(ctx.sessionID, symlinkPath)

        const write = await WriteTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await write.execute({ filePath: symlinkPath, content: "new content" }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("asks for external_directory when writing via symlink directory escape", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })

    // Create symlink to directory outside project
    const symlinkDir = path.join(tmp.path, "escape-dir")
    await $`ln -s ${outerTmp.path} ${symlinkDir}`.quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = await WriteTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        // Try to write to a file through the symlinked directory
        await write.execute({ filePath: path.join(symlinkDir, "pwned.txt"), content: "malicious" }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })
})
