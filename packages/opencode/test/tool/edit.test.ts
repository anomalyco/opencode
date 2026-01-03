import { describe, expect, test } from "bun:test"
import path from "path"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
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

describe("tool.edit basic functionality", () => {
  test("edits file content correctly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "test.txt")
        FileTime.read("test", filepath)
        await edit.execute(
          {
            filePath: filepath,
            oldString: "hello",
            newString: "goodbye",
          },
          ctx,
        )
        const content = await Bun.file(filepath).text()
        expect(content).toBe("goodbye world")
      },
    })
  })

  test("creates new file when oldString is empty", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "newfile.txt")
        await edit.execute(
          {
            filePath: filepath,
            oldString: "",
            newString: "new content",
          },
          ctx,
        )
        const content = await Bun.file(filepath).text()
        expect(content).toBe("new content")
      },
    })
  })

  test("throws error when oldString not found", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "test.txt")
        FileTime.read("test", filepath)
        await expect(
          edit.execute(
            {
              filePath: filepath,
              oldString: "nonexistent",
              newString: "replacement",
            },
            ctx,
          ),
        ).rejects.toThrow("oldString not found")
      },
    })
  })

  test("replaces all occurrences when replaceAll is true", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "foo bar foo baz foo")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "test.txt")
        FileTime.read("test", filepath)
        await edit.execute(
          {
            filePath: filepath,
            oldString: "foo",
            newString: "qux",
            replaceAll: true,
          },
          ctx,
        )
        const content = await Bun.file(filepath).text()
        expect(content).toBe("qux bar qux baz qux")
      },
    })
  })
})

describe("tool.edit granular permission patterns", () => {
  test("asks with relative path pattern for files inside project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "index.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "src", "index.ts")
        FileTime.read("test", filepath)
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await edit.execute(
          {
            filePath: filepath,
            oldString: "const x = 1",
            newString: "const x = 2",
          },
          testCtx,
        )
        const editReq = requests.find((r) => r.permission === "edit")
        expect(editReq).toBeDefined()
        // Pattern should end with the relative path from project root
        expect(editReq!.patterns[0].endsWith("src/index.ts")).toBe(true)
      },
    })
  })

  test("uses extension-based always pattern for files with extensions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "config.json"), '{"key": "value"}')
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "config.json")
        FileTime.read("test", filepath)
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await edit.execute(
          {
            filePath: filepath,
            oldString: '"value"',
            newString: '"newvalue"',
          },
          testCtx,
        )
        const editReq = requests.find((r) => r.permission === "edit")
        expect(editReq).toBeDefined()
        expect(editReq!.always).toEqual(["*.json"])
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
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "Makefile")
        FileTime.read("test", filepath)
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await edit.execute(
          {
            filePath: filepath,
            oldString: "echo hello",
            newString: "echo world",
          },
          testCtx,
        )
        const editReq = requests.find((r) => r.permission === "edit")
        expect(editReq).toBeDefined()
        // For files without extensions, always pattern should be the relative path
        expect(editReq!.always[0].endsWith("Makefile")).toBe(true)
      },
    })
  })

  test("uses correct extension for dotfiles with extensions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".eslintrc.json"), '{"rules": {}}')
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, ".eslintrc.json")
        FileTime.read("test", filepath)
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await edit.execute(
          {
            filePath: filepath,
            oldString: "{}",
            newString: '{"semi": true}',
          },
          testCtx,
        )
        const editReq = requests.find((r) => r.permission === "edit")
        expect(editReq).toBeDefined()
        expect(editReq!.always).toEqual(["*.json"])
      },
    })
  })

  test("new file creation uses extension-based always pattern", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "newfile.ts")
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await edit.execute(
          {
            filePath: filepath,
            oldString: "",
            newString: "export const hello = 'world'",
          },
          testCtx,
        )
        const editReq = requests.find((r) => r.permission === "edit")
        expect(editReq).toBeDefined()
        // Pattern should end with the relative path from project root
        expect(editReq!.patterns[0].endsWith("newfile.ts")).toBe(true)
        expect(editReq!.always).toEqual(["*.ts"])
      },
    })
  })
})

describe("tool.edit external_directory permission", () => {
  test("asks for external_directory permission when editing file outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "external.txt"), "external content")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(outerTmp.path, "external.txt")
        FileTime.read("test", filepath)
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await edit.execute(
          {
            filePath: filepath,
            oldString: "external content",
            newString: "modified content",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns.some((p) => p.includes(outerTmp.path))).toBe(true)
      },
    })
  })

  test("does not ask for external_directory permission when editing inside project", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "internal.txt"), "internal content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        const filepath = path.join(tmp.path, "internal.txt")
        FileTime.read("test", filepath)
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await edit.execute(
          {
            filePath: filepath,
            oldString: "internal content",
            newString: "modified content",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })
})
