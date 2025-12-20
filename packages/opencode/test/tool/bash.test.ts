import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })
})

describe("tool.bash permissions", () => {
  test("allows command matching allow pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              bash: {
                "echo *": "allow",
                "*": "deny",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("hello")
      },
    })
  })

  test("denies command matching deny pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              bash: {
                "curl *": "deny",
                "*": "allow",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        await expect(
          bash.execute(
            {
              command: "curl https://example.com",
              description: "Fetch URL",
            },
            ctx,
          ),
        ).rejects.toThrow("restricted")
      },
    })
  })

  test("denies all commands with wildcard deny", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              bash: {
                "*": "deny",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        await expect(
          bash.execute(
            {
              command: "ls",
              description: "List files",
            },
            ctx,
          ),
        ).rejects.toThrow("restricted")
      },
    })
  })

  test("more specific pattern overrides general pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              bash: {
                "*": "deny",
                "ls *": "allow",
                "pwd*": "allow",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // ls should be allowed
        const result = await bash.execute(
          {
            command: "ls -la",
            description: "List files",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)

        // pwd should be allowed
        const pwd = await bash.execute(
          {
            command: "pwd",
            description: "Print working directory",
          },
          ctx,
        )
        expect(pwd.metadata.exit).toBe(0)

        // cat should be denied
        await expect(
          bash.execute(
            {
              command: "cat /etc/passwd",
              description: "Read file",
            },
            ctx,
          ),
        ).rejects.toThrow("restricted")
      },
    })
  })

  test("denies dangerous subcommands while allowing safe ones", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              bash: {
                "find *": "allow",
                "find * -delete*": "deny",
                "find * -exec*": "deny",
                "*": "deny",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Basic find should work
        const result = await bash.execute(
          {
            command: "find . -name '*.ts'",
            description: "Find typescript files",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)

        // find -delete should be denied
        await expect(
          bash.execute(
            {
              command: "find . -name '*.tmp' -delete",
              description: "Delete temp files",
            },
            ctx,
          ),
        ).rejects.toThrow("restricted")

        // find -exec should be denied
        await expect(
          bash.execute(
            {
              command: "find . -name '*.ts' -exec cat {} \\;",
              description: "Find and cat files",
            },
            ctx,
          ),
        ).rejects.toThrow("restricted")
      },
    })
  })

  test("allows git read commands while denying writes", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              bash: {
                "git status*": "allow",
                "git log*": "allow",
                "git diff*": "allow",
                "git branch": "allow",
                "git commit *": "deny",
                "git push *": "deny",
                "*": "deny",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // git status should work
        const status = await bash.execute(
          {
            command: "git status",
            description: "Git status",
          },
          ctx,
        )
        expect(status.metadata.exit).toBe(0)

        // git log should work
        const log = await bash.execute(
          {
            command: "git log --oneline -5",
            description: "Git log",
          },
          ctx,
        )
        expect(log.metadata.exit).toBe(0)

        // git commit should be denied
        await expect(
          bash.execute(
            {
              command: "git commit -m 'test'",
              description: "Git commit",
            },
            ctx,
          ),
        ).rejects.toThrow("restricted")

        // git push should be denied
        await expect(
          bash.execute(
            {
              command: "git push origin main",
              description: "Git push",
            },
            ctx,
          ),
        ).rejects.toThrow("restricted")
      },
    })
  })

  test("denies external directory access when permission is deny", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: "deny",
              bash: {
                "*": "allow",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Should deny cd to parent directory (cd is checked for external paths)
        await expect(
          bash.execute(
            {
              command: "cd ../",
              description: "Change to parent directory",
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })

  test("denies workdir outside project when external_directory is deny", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              external_directory: "deny",
              bash: {
                "*": "allow",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        await expect(
          bash.execute(
            {
              command: "ls",
              workdir: "/tmp",
              description: "List /tmp",
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })

  test("handles multiple commands in sequence", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              bash: {
                "echo *": "allow",
                "curl *": "deny",
                "*": "deny",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // echo && echo should work
        const result = await bash.execute(
          {
            command: "echo foo && echo bar",
            description: "Echo twice",
          },
          ctx,
        )
        expect(result.metadata.output).toContain("foo")
        expect(result.metadata.output).toContain("bar")

        // echo && curl should fail (curl is denied)
        await expect(
          bash.execute(
            {
              command: "echo hi && curl https://example.com",
              description: "Echo then curl",
            },
            ctx,
          ),
        ).rejects.toThrow("restricted")
      },
    })
  })
})
