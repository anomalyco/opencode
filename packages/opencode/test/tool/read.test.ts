import { describe, expect, test } from "bun:test"
import path from "path"
import { ReadTool } from "../../src/tool/read"
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

describe("tool.read external_directory permissions", () => {
  test("denies reading external file when external_directory is deny", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: "deny",
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(
          read.execute(
            {
              filePath: "/etc/hosts",
            },
            ctx,
          ),
        ).rejects.toThrow("not in the current working directory")
      },
    })
  })

  test("denies reading external file when split permission has read: deny", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: {
                read: "deny",
                write: "allow",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        // Should deny because read permission is deny
        await expect(
          read.execute(
            {
              filePath: "/etc/hosts",
            },
            ctx,
          ),
        ).rejects.toThrow("not in the current working directory")
      },
    })
  })

  test("allows reading external file when split permission has read: allow", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: {
                read: "allow",
                write: "deny",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        // Should allow because read permission is allow
        const result = await read.execute(
          {
            filePath: "/etc/hosts",
          },
          ctx,
        )
        expect(result.output).toContain("<file>")
      },
    })
  })

  test("allows reading file inside project directory regardless of external_directory setting", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: "deny",
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        // Should allow because file is inside project directory
        const result = await read.execute(
          {
            filePath: path.join(tmp.path, "test.txt"),
          },
          ctx,
        )
        expect(result.output).toContain("hello world")
      },
    })
  })
})

