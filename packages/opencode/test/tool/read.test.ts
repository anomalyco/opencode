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

describe("tool.read external_directory permission", () => {
  test("allows reading absolute path inside project directory", async () => {
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
        const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        expect(result.output).toContain("hello world")
      },
    })
  })

  test("allows reading file in subdirectory inside project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "test.txt"), "nested content")
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
        const result = await read.execute({ filePath: path.join(tmp.path, "subdir", "test.txt") }, ctx)
        expect(result.output).toContain("nested content")
      },
    })
  })

  test("denies reading absolute path outside project directory", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secret.txt"), "secret data")
      },
    })
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
        await expect(read.execute({ filePath: path.join(outerTmp.path, "secret.txt") }, ctx)).rejects.toThrow(
          "not in the current working directory",
        )
      },
    })
  })

  test("denies reading relative path that traverses outside project directory", async () => {
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
        await expect(read.execute({ filePath: "../../../etc/passwd" }, ctx)).rejects.toThrow(
          "not in the current working directory",
        )
      },
    })
  })

  test("allows reading outside project directory when external_directory is allow", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "external.txt"), "external content")
      },
    })
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: "allow",
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(outerTmp.path, "external.txt") }, ctx)
        expect(result.output).toContain("external content")
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
