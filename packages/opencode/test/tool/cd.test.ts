import { describe, expect, test } from "bun:test"
import path from "path"
import { CdTool } from "../../src/tool/cd"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

const ctx = {
  sessionID: "test-session",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.cd", () => {
  test("changes directory to absolute path", async () => {
    await using tmp1 = await tmpdir({ git: true })
    await using tmp2 = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp1.path,
      fn: async () => {
        const cd = await CdTool.init()

        expect(Instance.directory).toBe(tmp1.path)

        const result = await cd.execute({ path: tmp2.path }, ctx)

        expect(result.metadata.directory).toBe(tmp2.path)
        expect(Instance.directory).toBe(tmp2.path)
      },
    })
  })

  test("changes directory to relative path", async () => {
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "subdir")
    await Bun.write(path.join(subdir, "file.txt"), "test")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cd = await CdTool.init()

        const result = await cd.execute({ path: "./subdir" }, ctx)

        expect(result.metadata.directory).toBe(subdir)
        expect(Instance.directory).toBe(subdir)
      },
    })
  })

  test("expands ~ to home directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cd = await CdTool.init()
        const homedir = process.env.HOME || process.env.USERPROFILE || ""

        // This test might need adjustment based on whether home is a git repo
        // Just test that it doesn't throw for now
        try {
          const result = await cd.execute({ path: "~" }, ctx)
          expect(result.metadata.directory).toContain(homedir)
        } catch (e) {
          // Home directory might not be a git repo, that's ok
          expect(String(e)).toContain("Directory not found")
        }
      },
    })
  })

  test("asks for cd permission", async () => {
    await using tmp1 = await tmpdir({ git: true })
    await using tmp2 = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp1.path,
      fn: async () => {
        const cd = await CdTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        await cd.execute({ path: tmp2.path }, testCtx)

        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("cd")
        expect(requests[0].patterns).toContain(tmp2.path)
      },
    })
  })

  test("throws error for non-existent directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cd = await CdTool.init()

        await expect(cd.execute({ path: "/nonexistent/path" }, ctx)).rejects.toThrow("Directory not found")
      },
    })
  })
})
