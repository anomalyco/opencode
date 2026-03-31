import { describe, expect, test } from "bun:test"
import path from "path"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { assertExternalDirectory } from "../../src/tool/external-directory"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

const glob = (p: string) =>
  process.platform === "win32" ? Filesystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

describe("tool.assertExternalDirectory", () => {
  test("no-ops for empty target", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp",
      fn: async () => {
        await assertExternalDirectory(ctx)
      },
    })

    expect(requests.length).toBe(0)
  })

  test("no-ops for paths inside Instance.directory", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp/project",
      fn: async () => {
        await assertExternalDirectory(ctx, path.join("/tmp/project", "file.txt"))
      },
    })

    expect(requests.length).toBe(0)
  })

  test("asks with a single canonical glob", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = "/tmp/project"
    const target = "/tmp/outside/file.txt"
    const expected = glob(path.join(path.dirname(target), "*"))

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target)
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
  })

  test("uses target directory when kind=directory", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = "/tmp/project"
    const target = "/tmp/outside"
    const expected = glob(path.join(target, "*"))

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target, { kind: "directory" })
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
  })

  test("skips prompting when bypass=true", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp/project",
      fn: async () => {
        await assertExternalDirectory(ctx, "/tmp/outside/file.txt", { bypass: true })
      },
    })

    expect(requests.length).toBe(0)
  })

  if (process.platform === "win32") {
    test("normalizes Windows path variants to one glob", async () => {
      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      const ctx: Tool.Context = {
        ...baseCtx,
        ask: async (req) => {
          requests.push(req)
        },
      }

      await using outerTmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "outside.txt"), "x")
        },
      })
      await using tmp = await tmpdir({ git: true })

      const target = path.join(outerTmp.path, "outside.txt")
      const alt = target
        .replace(/^[A-Za-z]:/, "")
        .replaceAll("\\", "/")
        .toLowerCase()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await assertExternalDirectory(ctx, alt)
        },
      })

      const req = requests.find((r) => r.permission === "external_directory")
      const expected = glob(path.join(outerTmp.path, "*"))
      expect(req).toBeDefined()
      expect(req!.patterns).toEqual([expected])
      expect(req!.always).toEqual([expected])
    })

    test("uses drive root glob for root files", async () => {
      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      const ctx: Tool.Context = {
        ...baseCtx,
        ask: async (req) => {
          requests.push(req)
        },
      }

      await using tmp = await tmpdir({ git: true })
      const root = path.parse(tmp.path).root
      const target = path.join(root, "boot.ini")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await assertExternalDirectory(ctx, target)
        },
      })

      const req = requests.find((r) => r.permission === "external_directory")
      const expected = path.join(root, "*")
      expect(req).toBeDefined()
      expect(req!.patterns).toEqual([expected])
      expect(req!.always).toEqual([expected])
    })
  }
})
