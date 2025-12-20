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

describe("tool.read external_directory pattern-based permissions", () => {
  test("allows reading when path matches allow pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: {
                read: {
                  "/etc/**": "allow",
                  "*": "deny",
                },
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
        // Should allow because /etc/hosts matches "/etc/**" pattern
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

  test("denies reading when path matches deny pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: {
                read: {
                  "/etc/**": "deny",
                  "*": "allow",
                },
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
        // Should deny because /etc/hosts matches "/etc/**" pattern which is deny
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

  test("falls back to * (catch-all) when no pattern matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: {
                read: {
                  "/nonexistent/**": "allow",
                  "*": "deny",
                },
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
        // Should deny because /etc/hosts doesn't match any specific pattern, falls back to "*" which is deny
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

  test("first matching pattern takes precedence (insertion order)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: {
                read: {
                  "/etc/hosts": "allow",
                  "/etc/**": "deny",
                  "*": "deny",
                },
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
        // Should allow because "/etc/hosts" is matched first (before "/etc/**")
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

  test("allows when no * pattern exists and no match (undefined = allow)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: {
                read: {
                  "/nonexistent/**": "deny",
                },
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
        // Should allow because /etc/hosts doesn't match any pattern and no "*" fallback exists (undefined = allow)
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

  test("mixed config: pattern map for read, simple value for write", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: {
                read: {
                  "/etc/**": "allow",
                  "*": "deny",
                },
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
        // read should allow because /etc/hosts matches "/etc/**" pattern
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
})

