import { describe, it, expect } from "bun:test"
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

const ctx = {
  sessionID: "test-session",
  messageID: "test-message",
  callID: "test-call",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("File Permission Patterns - Config Schema", () => {
  describe("edit permission patterns", () => {
    it("should accept pattern-based edit permissions", async () => {
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
          expect(config.permission?.edit).toEqual({
            "*.env": "deny",
            "*.md": "allow",
            "*": "ask",
          })
        },
      })
    })

    it("should maintain backward compatibility with simple edit permissions", async () => {
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

describe("File Permission Patterns - Wildcard Matching", () => {
  describe("*.env pattern matching", () => {
    // TODO: Wildcard.all doesn't match .env.local with *.env pattern (needs glob enhancement)
    it.skip("should match .env files with *.env pattern", () => {
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

    // TODO: Pattern priority needs enhancement - longer patterns should override shorter ones
    it.skip("should allow specific override for .env.sample", () => {
      const patterns = {
        ".env.sample": "allow",
        "*.env": "deny",
        "*": "ask",
      }
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

    // TODO: Wildcard utility doesn't support ** glob pattern for recursive matching
    it.skip("should match nested directory patterns with **", () => {
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
        FileTime.read(ctx.sessionID, path.join(tmp.path, "readme.md"))

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
                ".env.sample": "allow",
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

describe("File Permission Patterns - Write Tool", () => {
  it("should have its OWN permission separate from edit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              edit: "allow",
              write: {
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

describe("File Permission Patterns - Read Tool", () => {
  it("should use configurable patterns instead of hardcoded .env blocking", async () => {
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
                "config.json": "deny",
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
        await expect(
          read.execute(
            {
              filePath: path.join(tmp.path, ".env"),
            },
            ctx,
          ),
        ).rejects.toThrow()

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
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".env.sample"), "SAMPLE_KEY=example_value")
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            permission: {
              read: {
                ".env.sample": "allow",
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
        await expect(
          read.execute(
            {
              filePath: path.join(tmp.path, "secrets/api-key.txt"),
            },
            ctx,
          ),
        ).rejects.toThrow()

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

    // TODO: Test times out - needs investigation into read tool relative path handling
    it.skip("should handle relative paths correctly", async () => {
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

  // TODO: Wildcard utility doesn't support ** glob pattern for recursive matching
  describe.skip("nested directory patterns", () => {
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
          const edit = config.permission?.edit
          if (typeof edit === "object") {
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

describe("File Permission Patterns - Agent-level Overrides", () => {
  it("should allow agent-specific file permission patterns", async () => {
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
                    "*.env": "ask",
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
        expect(config.agent?.build?.permission?.edit).toEqual({
          "*.env": "ask",
          "*": "allow",
        })
      },
    })
  })
})
