import { test, expect, describe } from "bun:test"
import path from "path"
import os from "os"
import { assertSafePath, isPathSafe } from "../../src/tool/path-guard"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("path-guard", () => {
  describe("assertSafePath", () => {
    describe("shell expansion blocking", () => {
      test("blocks paths with $VAR expansion", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath("$HOME/file.txt")).toThrow("shell expansion pattern")
          },
        })
      })

      test("blocks paths with ${VAR} expansion", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath("/home/${USER}/file.txt")).toThrow("shell expansion pattern")
          },
        })
      })

      test("blocks paths with command substitution $()", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath("/home/$(whoami)/file.txt")).toThrow("shell expansion pattern")
          },
        })
      })

      test("blocks paths with backtick command substitution", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath("/home/`whoami`/file.txt")).toThrow("shell expansion pattern")
          },
        })
      })

      test("allows normal paths without expansion", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(tmp.path, "src", "file.txt"))).not.toThrow()
          },
        })
      })
    })

    describe("path traversal blocking", () => {
      test("blocks traversal that escapes working directory", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            // Raw string with .. segments - path.join normalizes them away
            const escapePath = tmp.path + "/../../../etc/passwd"
            expect(() => assertSafePath(escapePath)).toThrow("Path traversal blocked")
          },
        })
      })

      test("allows .. that stays within working directory", async () => {
        await using tmp = await tmpdir({ git: true })
        // Create a subdirectory to test .. staying within
        const subpath = path.join(tmp.path, "subdir", "..", "file.txt")
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            // This normalizes to tmp.path/file.txt which is within the working directory
            expect(() => assertSafePath(subpath)).not.toThrow()
          },
        })
      })

      test("blocks relative .. escaping", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            // Relative path escaping the working directory
            expect(() => assertSafePath("../../etc/passwd")).toThrow("Path traversal blocked")
          },
        })
      })
    })

    describe("dangerous directory blocking", () => {
      test("blocks .git directory access", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(tmp.path, ".git", "config"))).toThrow(".git directory")
          },
        })
      })

      test("blocks .bashrc access", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(os.homedir(), ".bashrc"))).toThrow(".bashrc")
          },
        })
      })

      test("blocks .zshrc access", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(os.homedir(), ".zshrc"))).toThrow(".zshrc")
          },
        })
      })

      test("blocks .profile access", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(os.homedir(), ".profile"))).toThrow(".profile")
          },
        })
      })

      test("blocks .ssh directory access", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(os.homedir(), ".ssh", "id_rsa"))).toThrow(".ssh directory")
          },
        })
      })

      test("blocks .env files", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(tmp.path, ".env"))).toThrow(".env file")
          },
        })
      })

      test("blocks .env.local files", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(tmp.path, ".env.local"))).toThrow(".env.* file")
          },
        })
      })

      test("allows normal project files", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(() => assertSafePath(path.join(tmp.path, "src", "index.ts"))).not.toThrow()
            expect(() => assertSafePath(path.join(tmp.path, "package.json"))).not.toThrow()
          },
        })
      })
    })
  })

  describe("isPathSafe", () => {
    test("returns safe:true for normal paths", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = isPathSafe(path.join(tmp.path, "src", "file.ts"))
          expect(result.safe).toBe(true)
          expect(result.reason).toBeUndefined()
        },
      })
    })

    test("returns safe:false for dangerous paths", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = isPathSafe(path.join(tmp.path, ".git", "config"))
          expect(result.safe).toBe(false)
          expect(result.reason).toContain(".git directory")
        },
      })
    })

    test("returns safe:false for shell expansion paths", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = isPathSafe("$HOME/file.txt")
          expect(result.safe).toBe(false)
          expect(result.reason).toContain("shell expansion pattern")
        },
      })
    })

    test("returns safe:false for path traversal that escapes", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = isPathSafe("../../etc/passwd")
          expect(result.safe).toBe(false)
          expect(result.reason).toContain("Path traversal blocked")
        },
      })
    })
  })
})
