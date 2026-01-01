/**
 * TDD Tests for File Permission Patterns
 *
 * This test file defines the expected behavior for the new file permission pattern system
 * that will add glob/regex-based permission controls for OpenCode's `edit`, `write`, and `read` tools.
 *
 * These tests are EXPECTED TO FAIL initially - this is TDD (Test-Driven Development).
 * The implementation will be added separately to make these tests pass.
 *
 * The feature adds pattern-based permissions similar to how `bash` permissions work:
 * ```jsonc
 * "permission": {
 *   "edit": {
 *     "*.env": "deny",
 *     ".github/workflows/*": "ask",
 *     "*.md": "allow"
 *   }
 * }
 * ```
 */

import { describe, it, expect, test, beforeEach } from "bun:test"
import path from "path"
import { Config } from "../src/config/config"
import { Wildcard } from "../src/util/wildcard"
import { Instance } from "../src/project/instance"
import { Permission } from "../src/permission"
import { tmpdir } from "./fixture/fixture"
import { EditTool } from "../src/tool/edit"
import { WriteTool } from "../src/tool/write"
import { ReadTool } from "../src/tool/read"
import { FileTime } from "../src/file/time"

// Test context for tool execution
const ctx = {
  sessionID: "test-session",
  messageID: "test-message",
  callID: "test-call",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

// =============================================================================
// PART 1: Config Schema Tests
// =============================================================================

describe("File Permission Patterns - Config Schema", () => {
  describe("edit permission patterns", () => {
    it("should accept pattern-based edit permissions", async () => {
      // This test verifies that the config schema accepts pattern-based permissions for edit
      // Currently, edit only accepts simple Permission values ("ask", "allow", "deny")
      // The new feature should allow a record of patterns to permissions
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                edit: {
                  "*.env": "deny",
                  "*.md": "allow",
                  "*": "ask",
                },
              },
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          // Once implemented, edit should accept a record of patterns
          expect(config.permission?.edit).toEqual({
            "*.env": "deny",
            "*.md": "allow",
            "*": "ask",
          })
        },
      })
    })

    it("should maintain backward compatibility with simple edit permissions", async () => {
      // The old format (simple string) should still work
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                edit: "ask",
              },
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.permission?.edit).toBe("ask")
        },
      })
    })
  })

  describe("write permission patterns", () => {
    it("should accept pattern-based write permissions", async () => {
      // Write tool should have its own permission configuration
      // Currently write uses the edit permission, but it should have its own
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                write: {
                  "*.env": "deny",
                  "credentials.json": "deny",
                  "*.ts": "allow",
                },
              },
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          // Once implemented, write should have its own permission patterns
          expect(config.permission?.write).toEqual({
            "*.env": "deny",
            "credentials.json": "deny",
            "*.ts": "allow",
          })
        },
      })
    })

    it("should maintain backward compatibility with simple write permissions", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                write: "deny",
              },
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.permission?.write).toBe("deny")
        },
      })
    })
  })

  describe("read permission patterns", () => {
    it("should accept pattern-based read permissions", async () => {
      // Read tool should have configurable patterns instead of hardcoded .env blocking
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                read: {
                  "*.env": "deny",
                  ".env.sample": "allow",
                  "secrets/*": "deny",
                },
              },
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          // Once implemented, read should have configurable permission patterns
          expect(config.permission?.read).toEqual({
            "*.env": "deny",
            ".env.sample": "allow",
            "secrets/*": "deny",
          })
        },
      })
    })

    it("should maintain backward compatibility with simple read permissions", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                read: "allow",
              },
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.permission?.read).toBe("allow")
        },
      })
    })
  })
})

// =============================================================================
// PART 2: Wildcard Matching Tests for File Paths
// =============================================================================

describe("File Permission Patterns - Wildcard Matching", () => {
  describe("*.env pattern matching", () => {
    it("should match .env files with *.env pattern", () => {
      const patterns = {
        "*.env": "deny",
        "*": "allow",
      }
      expect(Wildcard.all(".env", patterns)).toBe("deny")
      expect(Wildcard.all(".env.local", patterns)).toBe("deny")
      expect(Wildcard.all(".env.production", patterns)).toBe("deny")
    })

    it("should NOT match non-.env files with *.env pattern", () => {
      const patterns = {
        "*.env": "deny",
        "*": "allow",
      }
      expect(Wildcard.all(".envrc", patterns)).toBe("allow")
      expect(Wildcard.all("config.json", patterns)).toBe("allow")
      expect(Wildcard.all("environment.ts", patterns)).toBe("allow")
    })

    it("should allow specific override for .env.sample", () => {
      const patterns = {
        ".env.sample": "allow",
        "*.env": "deny",
        "*": "ask",
      }
      // More specific pattern should win
      expect(Wildcard.all(".env.sample", patterns)).toBe("allow")
      expect(Wildcard.all(".env", patterns)).toBe("deny")
      expect(Wildcard.all(".env.local", patterns)).toBe("deny")
    })
  })

  describe("directory pattern matching", () => {
    it("should match files in .github/workflows/*", () => {
      const patterns = {
        ".github/workflows/*": "ask",
        "*": "allow",
      }
      expect(Wildcard.all(".github/workflows/ci.yml", patterns)).toBe("ask")
      expect(Wildcard.all(".github/workflows/deploy.yml", patterns)).toBe("ask")
    })

    it("should match nested directory patterns with **", () => {
      const patterns = {
        "src/**/*.ts": "allow",
        "*": "deny",
      }
      expect(Wildcard.all("src/index.ts", patterns)).toBe("allow")
      expect(Wildcard.all("src/util/helper.ts", patterns)).toBe("allow")
      expect(Wildcard.all("src/deep/nested/file.ts", patterns)).toBe("allow")
    })

    it("should match secrets directory patterns", () => {
      const patterns = {
        "secrets/*": "deny",
        "config/*": "allow",
        "*": "ask",
      }
      expect(Wildcard.all("secrets/api-key.txt", patterns)).toBe("deny")
      expect(Wildcard.all("secrets/credentials.json", patterns)).toBe("deny")
      expect(Wildcard.all("config/settings.json", patterns)).toBe("allow")
    })
  })

  describe("pattern priority", () => {
    it("should use most specific pattern (longest match)", () => {
      const patterns = {
        "*": "deny",
        "*.ts": "allow",
        "src/*.ts": "ask",
      }
      // More specific patterns should override general ones
      expect(Wildcard.all("src/index.ts", patterns)).toBe("ask")
      expect(Wildcard.all("lib/index.ts", patterns)).toBe("allow")
      expect(Wildcard.all("readme.md", patterns)).toBe("deny")
    })

    it("should handle multiple matching patterns correctly", () => {
      const patterns = {
        "*": "deny",
        "*.json": "allow",
        "package*.json": "ask",
        "package-lock.json": "deny",
      }
      expect(Wildcard.all("package-lock.json", patterns)).toBe("deny")
      expect(Wildcard.all("package.json", patterns)).toBe("ask")
      expect(Wildcard.all("tsconfig.json", patterns)).toBe("allow")
      expect(Wildcard.all("index.ts", patterns)).toBe("deny")
    })
  })

  describe("edge cases", () => {
    it("should handle empty pattern object (allow all)", () => {
      const patterns = {}
      // Empty patterns should return undefined (no match)
      expect(Wildcard.all("any-file.txt", patterns)).toBeUndefined()
    })

    it("should handle patterns with special characters", () => {
      const patterns = {
        "*.config.js": "allow",
        "[test]*": "deny",
        "*": "ask",
      }
      expect(Wildcard.all("webpack.config.js", patterns)).toBe("allow")
      expect(Wildcard.all("babel.config.js", patterns)).toBe("allow")
    })
  })
})

// =============================================================================
// PART 3: Edit Tool Permission Tests
// =============================================================================

describe("File Permission Patterns - Edit Tool", () => {
  it("should deny editing files matching deny pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".env"), "SECRET=value")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              edit: {
                "*.env": "deny",
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
        const edit = await EditTool.init()
        // Editing .env should be denied based on pattern
        await expect(
          edit.execute(
            {
              filePath: path.join(tmp.path, ".env"),
              oldString: "SECRET=value",
              newString: "SECRET=newvalue",
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })

  it("should allow editing files matching allow pattern without prompting", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "readme.md"), "# Hello")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              edit: {
                "*.md": "allow",
                "*": "ask",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        // Manually mark file as read to satisfy FileTime.assert
        FileTime.read(ctx.sessionID, path.join(tmp.path, "readme.md"))

        // Editing .md files should be allowed without prompting
        const result = await edit.execute(
          {
            filePath: path.join(tmp.path, "readme.md"),
            oldString: "# Hello",
            newString: "# Hello World",
          },
          ctx,
        )
        expect(result.metadata.diff).toContain("Hello World")
      },
    })
  })

  it("should respect pattern priority for edit permissions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".env.sample"), "SAMPLE=value")
        await Bun.write(path.join(dir, ".env.local"), "LOCAL=value")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              edit: {
                ".env.sample": "allow", // More specific - should override
                "*.env": "deny",
                "*": "ask",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        // .env.sample should be allowed (more specific pattern)
        FileTime.read(ctx.sessionID, path.join(tmp.path, ".env.sample"))
        const result = await edit.execute(
          {
            filePath: path.join(tmp.path, ".env.sample"),
            oldString: "SAMPLE=value",
            newString: "SAMPLE=newvalue",
          },
          ctx,
        )
        expect(result.metadata.diff).toContain("newvalue")

        // .env.local should be denied (matches *.env pattern)
        await expect(
          edit.execute(
            {
              filePath: path.join(tmp.path, ".env.local"),
              oldString: "LOCAL=value",
              newString: "LOCAL=newvalue",
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })

  it("should handle directory-based edit patterns", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".github", "workflows", "ci.yml"), "name: CI")
        await Bun.write(path.join(dir, "src", "index.ts"), "export {}")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              edit: {
                ".github/workflows/*": "deny",
                "src/*": "allow",
                "*": "ask",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        // Workflow files should be denied
        await expect(
          edit.execute(
            {
              filePath: path.join(tmp.path, ".github/workflows/ci.yml"),
              oldString: "name: CI",
              newString: "name: New CI",
            },
            ctx,
          ),
        ).rejects.toThrow()

        // src files should be allowed
        FileTime.read(ctx.sessionID, path.join(tmp.path, "src/index.ts"))
        const result = await edit.execute(
          {
            filePath: path.join(tmp.path, "src/index.ts"),
            oldString: "export {}",
            newString: 'export const foo = "bar"',
          },
          ctx,
        )
        expect(result.metadata.diff).toContain("foo")
      },
    })
  })
})

// =============================================================================
// PART 4: Write Tool Permission Tests
// =============================================================================

describe("File Permission Patterns - Write Tool", () => {
  it("should have its OWN permission separate from edit", async () => {
    // Write should have separate permissions from edit
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              edit: "allow", // Edit allows everything
              write: {
                // Write has pattern restrictions
                "*.env": "deny",
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
        const write = await WriteTool.init()
        // Writing .env should be denied by write permission (not edit)
        await expect(
          write.execute(
            {
              filePath: path.join(tmp.path, ".env"),
              content: "SECRET=value",
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })

  it("should deny writing files matching deny pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              write: {
                "credentials.json": "deny",
                "secrets/*": "deny",
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
        const write = await WriteTool.init()
        // credentials.json should be denied
        await expect(
          write.execute(
            {
              filePath: path.join(tmp.path, "credentials.json"),
              content: '{"apiKey": "secret"}',
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })

  it("should allow writing new files matching allow pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              write: {
                "*.ts": "allow",
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
        const write = await WriteTool.init()
        // Writing .ts files should be allowed
        const result = await write.execute(
          {
            filePath: path.join(tmp.path, "new-file.ts"),
            content: 'export const hello = "world"',
          },
          ctx,
        )
        expect(result.metadata.filepath).toContain("new-file.ts")
      },
    })
  })

  it("should block writing to protected directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              write: {
                ".git/*": "deny",
                "node_modules/*": "deny",
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
        const write = await WriteTool.init()
        // Writing to .git should be denied
        await expect(
          write.execute(
            {
              filePath: path.join(tmp.path, ".git/config"),
              content: "[core]\n  autocrlf = false",
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })
})

// =============================================================================
// PART 5: Read Tool Permission Tests
// =============================================================================

describe("File Permission Patterns - Read Tool", () => {
  it("should use configurable patterns instead of hardcoded .env blocking", async () => {
    // Currently read has hardcoded .env blocking - this should be configurable
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".env"), "SECRET=value")
        await Bun.write(path.join(dir, "config.json"), '{"key": "value"}')
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              read: {
                "*.env": "deny",
                "config.json": "deny", // Also deny config.json via pattern
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
        const read = await ReadTool.init()
        // .env should still be denied
        await expect(
          read.execute(
            {
              filePath: path.join(tmp.path, ".env"),
            },
            ctx,
          ),
        ).rejects.toThrow()

        // config.json should ALSO be denied via pattern
        await expect(
          read.execute(
            {
              filePath: path.join(tmp.path, "config.json"),
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })

  it("should allow .env.sample via pattern override", async () => {
    // The new system should allow overriding the .env block with more specific patterns
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".env.sample"), "SAMPLE_KEY=example_value")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              read: {
                ".env.sample": "allow", // Explicitly allow
                ".env.example": "allow",
                "*.env": "deny",
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
        const read = await ReadTool.init()
        // .env.sample should be allowed via pattern override
        const result = await read.execute(
          {
            filePath: path.join(tmp.path, ".env.sample"),
          },
          ctx,
        )
        expect(result.output).toContain("SAMPLE_KEY")
      },
    })
  })

  it("should deny reading files in secrets directory via pattern", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secrets", "api-key.txt"), "sk-12345")
        await Bun.write(path.join(dir, "public", "readme.txt"), "public content")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              read: {
                "secrets/*": "deny",
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
        const read = await ReadTool.init()
        // secrets/* should be denied
        await expect(
          read.execute(
            {
              filePath: path.join(tmp.path, "secrets/api-key.txt"),
            },
            ctx,
          ),
        ).rejects.toThrow()

        // public/* should be allowed
        const result = await read.execute(
          {
            filePath: path.join(tmp.path, "public/readme.txt"),
          },
          ctx,
        )
        expect(result.output).toContain("public content")
      },
    })
  })

  it("should support simple read permission (backward compatible)", async () => {
    // Simple "deny" should deny all reads
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "content")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              read: "deny",
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        // All reads should be denied with simple "deny" permission
        await expect(
          read.execute(
            {
              filePath: path.join(tmp.path, "test.txt"),
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })
})

// =============================================================================
// PART 6: Edge Cases and Advanced Scenarios
// =============================================================================

describe("File Permission Patterns - Edge Cases", () => {
  describe("path handling", () => {
    it("should handle absolute paths correctly", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "sensitive.txt"), "sensitive")
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                read: {
                  "sensitive.txt": "deny",
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
          const read = await ReadTool.init()
          // Absolute path should still match the pattern
          await expect(
            read.execute(
              {
                filePath: path.join(tmp.path, "sensitive.txt"),
              },
              ctx,
            ),
          ).rejects.toThrow()
        },
      })
    })

    it("should handle relative paths correctly", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "blocked.txt"), "blocked")
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                read: {
                  "blocked.txt": "deny",
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
          const read = await ReadTool.init()
          // Relative path should be resolved and matched
          await expect(
            read.execute(
              {
                filePath: "blocked.txt",
              },
              ctx,
            ),
          ).rejects.toThrow()
        },
      })
    })
  })

  describe("nested directory patterns", () => {
    it("should match src/**/*.ts pattern for deeply nested files", async () => {
      const patterns = {
        "src/**/*.ts": "allow",
        "*": "deny",
      }
      expect(Wildcard.all("src/index.ts", patterns)).toBe("allow")
      expect(Wildcard.all("src/utils/helper.ts", patterns)).toBe("allow")
      expect(Wildcard.all("src/deep/nested/component.ts", patterns)).toBe("allow")
      expect(Wildcard.all("test/index.ts", patterns)).toBe("deny")
    })

    it("should match config/**/* pattern", async () => {
      const patterns = {
        "config/**/*": "deny",
        "*": "allow",
      }
      expect(Wildcard.all("config/dev.json", patterns)).toBe("deny")
      expect(Wildcard.all("config/env/production.json", patterns)).toBe("deny")
      expect(Wildcard.all("src/config.ts", patterns)).toBe("allow")
    })
  })

  describe("default behavior", () => {
    it("should default to ask when no pattern matches and no default", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "random.txt"), "content")
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                edit: {
                  "*.ts": "allow",
                  // No default "*" pattern
                },
              },
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          // When no pattern matches, the behavior should fallback to default (ask)
          const edit = config.permission?.edit
          if (typeof edit === "object") {
            // No pattern matches random.txt, so Wildcard.all returns undefined
            const match = Wildcard.all("random.txt", edit)
            expect(match).toBeUndefined()
          }
        },
      })
    })

    it("should work with empty permission object", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "test.txt"), "content")
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {},
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          // Empty permission should use defaults
          expect(config.permission?.edit).toBeUndefined()
          expect(config.permission?.write).toBeUndefined()
          expect(config.permission?.read).toBeUndefined()
        },
      })
    })
  })

  describe("combined tool permissions", () => {
    it("should support different patterns for edit, write, and read on same file type", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              permission: {
                edit: {
                  "*.config.js": "ask",
                  "*": "allow",
                },
                write: {
                  "*.config.js": "deny",
                  "*": "allow",
                },
                read: {
                  "*.config.js": "allow",
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
          const config = await Config.get()
          // Each tool should have independent permission evaluation
          expect(config.permission?.edit).toEqual({
            "*.config.js": "ask",
            "*": "allow",
          })
          expect(config.permission?.write).toEqual({
            "*.config.js": "deny",
            "*": "allow",
          })
          expect(config.permission?.read).toEqual({
            "*.config.js": "allow",
            "*": "allow",
          })
        },
      })
    })
  })
})

// =============================================================================
// PART 7: Agent-level Permission Override Tests
// =============================================================================

describe("File Permission Patterns - Agent-level Overrides", () => {
  it("should allow agent-specific file permission patterns", async () => {
    // Agent-level permissions should override global permissions
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              edit: {
                "*.env": "deny",
                "*": "ask",
              },
            },
            agent: {
              build: {
                permission: {
                  edit: {
                    "*.env": "ask", // Override: build agent can ask for .env
                    "*": "allow",
                  },
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
        const config = await Config.get()
        // Agent should have its own permission override
        expect(config.agent?.build?.permission?.edit).toEqual({
          "*.env": "ask",
          "*": "allow",
        })
      },
    })
  })
})
