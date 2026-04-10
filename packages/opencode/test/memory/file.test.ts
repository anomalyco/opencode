import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { MemoryFile } from "../../src/memory/file"
import { Memory } from "../../src/memory/types"
import { tmpdir } from "../fixture/fixture"

describe("memory.file", () => {
  test("writeEntry and readEntry round-trip", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const entry: Memory.FileEntry = {
          filename: "test-entry.md",
          frontmatter: { name: "test topic", type: "project" },
          content: "Some test content here.",
        }
        await MemoryFile.writeEntry(entry)
        const read = await MemoryFile.readEntry("test-entry.md")
        expect(read).toBeDefined()
        expect(read!.filename).toBe("test-entry.md")
        expect(read!.frontmatter.name).toBe("test topic")
        expect(read!.frontmatter.type).toBe("project")
        expect(read!.content).toBe("Some test content here.")
      },
    })
  })

  test("readEntry returns undefined for non-existent file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await MemoryFile.readEntry("does-not-exist.md")
        expect(read).toBeUndefined()
      },
    })
  })

  test("writeIndex and readIndex round-trip", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = "# Memory Index\n- [Entry 1](entry1.md) — first entry\n- [Entry 2](entry2.md) — second entry"
        await MemoryFile.writeIndex(content)
        const read = await MemoryFile.readIndex()
        expect(read).toBe(content)
      },
    })
  })

  test("readIndex returns undefined when file does not exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await MemoryFile.readIndex()
        expect(read).toBeUndefined()
      },
    })
  })

  test("readIndex truncates at maxLines", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lines = Array.from({ length: 300 }, (_, i) => `Line ${i}`)
        await MemoryFile.writeIndex(lines.join("\n"))
        const read = await MemoryFile.readIndex(10)
        expect(read).toBeDefined()
        expect(read!.split("\n").length).toBe(10)
        expect(read!.startsWith("Line 0")).toBe(true)
      },
    })
  })

  test("path traversal is rejected", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MemoryFile.writeIndex("# init")

        expect(() => MemoryFile.readEntry("../../etc/passwd")).toThrow("path traversal detected")
        expect(() =>
          MemoryFile.writeEntry({
            filename: "../../../etc/evil.md",
            frontmatter: { name: "evil", type: "project" },
            content: "bad",
          }),
        ).toThrow("path traversal detected")
      },
    })
  })

  test("empty filename is rejected", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(() => MemoryFile.readEntry("")).toThrow("path traversal detected")
        expect(() => MemoryFile.readEntry(".")).toThrow("path traversal detected")
      },
    })
  })

  test("removeEntry deletes file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const entry: Memory.FileEntry = {
          filename: "removable.md",
          frontmatter: { name: "removable", type: "project" },
          content: "to be removed",
        }
        await MemoryFile.writeEntry(entry)
        const before = await MemoryFile.readEntry("removable.md")
        expect(before).toBeDefined()

        await MemoryFile.removeEntry("removable.md")
        const after = await MemoryFile.readEntry("removable.md")
        expect(after).toBeUndefined()
      },
    })
  })

  test("listEntries returns all markdown entries", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MemoryFile.writeEntry({
          filename: "entry-a.md",
          frontmatter: { name: "A", type: "project" },
          content: "content a",
        })
        await MemoryFile.writeEntry({
          filename: "entry-b.md",
          frontmatter: { name: "B", type: "user" },
          content: "content b",
        })
        await MemoryFile.writeIndex("# Index")

        const entries = await MemoryFile.listEntries()
        expect(entries.length).toBe(2)
        const names = entries.map((e) => e.frontmatter.name).sort()
        expect(names).toEqual(["A", "B"])
      },
    })
  })

  test("writeEntry creates directory structure", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = MemoryFile.getMemoryDir()
        const existsBefore = await fs
          .stat(dir)
          .then(() => true)
          .catch(() => false)
        expect(existsBefore).toBe(false)

        await MemoryFile.writeEntry({
          filename: "first.md",
          frontmatter: { name: "first", type: "project" },
          content: "first entry",
        })

        const existsAfter = await fs
          .stat(dir)
          .then(() => true)
          .catch(() => false)
        expect(existsAfter).toBe(true)
      },
    })
  })

  test("readEntry returns undefined for file without valid frontmatter", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = MemoryFile.getMemoryDir()
        await fs.mkdir(dir, { recursive: true })
        await Bun.write(path.join(dir, "bad.md"), "no frontmatter here")
        const read = await MemoryFile.readEntry("bad.md")
        expect(read).toBeUndefined()
      },
    })
  })

  test.each(Memory.TYPES.map((t) => [t]))("readEntry parses valid new type: %s", async (validType) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = MemoryFile.getMemoryDir()
        await fs.mkdir(dir, { recursive: true })
        const raw = `---\nname: test\ntype: ${validType}\n---\nsome content`
        await Bun.write(path.join(dir, "valid-type.md"), raw)
        const read = await MemoryFile.readEntry("valid-type.md")
        expect(read).toBeDefined()
        expect(read!.frontmatter.type).toBe(validType)
        expect(read!.frontmatter.name).toBe("test")
        expect(read!.content).toBe("some content")
      },
    })
  })

  test.each([
    ["error-solution", "project"],
    ["build-command", "project"],
    ["preference", "user"],
    ["decision", "feedback"],
    ["config-pattern", "project"],
    ["general", "project"],
  ] as const)("readEntry maps legacy type %s to %s", async (legacyType, expectedType) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = MemoryFile.getMemoryDir()
        await fs.mkdir(dir, { recursive: true })
        const raw = `---\ntopic: legacy test\ntype: ${legacyType}\n---\nlegacy content`
        await Bun.write(path.join(dir, "legacy.md"), raw)
        const read = await MemoryFile.readEntry("legacy.md")
        expect(read).toBeDefined()
        expect(read!.frontmatter.type).toBe(expectedType)
        expect(read!.frontmatter.name).toBe("legacy test")
        expect(read!.content).toBe("legacy content")
      },
    })
  })

  test("readEntry returns undefined for invalid type in frontmatter", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = MemoryFile.getMemoryDir()
        await fs.mkdir(dir, { recursive: true })
        const raw = "---\nname: test\ntype: invalid-type\n---\nsome content"
        await Bun.write(path.join(dir, "invalid-type.md"), raw)
        const read = await MemoryFile.readEntry("invalid-type.md")
        expect(read).toBeUndefined()
      },
    })
  })

  test("readEntry returns undefined for missing type in frontmatter", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = MemoryFile.getMemoryDir()
        await fs.mkdir(dir, { recursive: true })
        const raw = "---\nname: test\n---\nsome content"
        await Bun.write(path.join(dir, "no-type.md"), raw)
        const read = await MemoryFile.readEntry("no-type.md")
        expect(read).toBeUndefined()
      },
    })
  })

  test("readEntry parses scope and agent from frontmatter", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = MemoryFile.getMemoryDir()
        await fs.mkdir(dir, { recursive: true })
        const raw = "---\nname: scoped entry\ndescription: A test description\ntype: user\nscope: personal\nagent: build\n---\nscoped content"
        await Bun.write(path.join(dir, "scoped.md"), raw)
        const read = await MemoryFile.readEntry("scoped.md")
        expect(read).toBeDefined()
        expect(read!.frontmatter.name).toBe("scoped entry")
        expect(read!.frontmatter.description).toBe("A test description")
        expect(read!.frontmatter.type).toBe("user")
        expect(read!.frontmatter.scope).toBe("personal")
        expect(read!.frontmatter.agent).toBe("build")
      },
    })
  })

  test("writeEntry outputs new frontmatter format with scope and description", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const entry: Memory.FileEntry = {
          filename: "full-entry.md",
          frontmatter: {
            name: "Full entry",
            description: "A complete entry with all fields",
            type: "feedback",
            scope: "project",
            agent: "review",
          },
          content: "Full content here.",
        }
        await MemoryFile.writeEntry(entry)
        const raw = await Bun.file(path.join(MemoryFile.getMemoryDir(), "full-entry.md")).text()
        expect(raw).toContain("name: Full entry")
        expect(raw).toContain("description: A complete entry with all fields")
        expect(raw).toContain("type: feedback")
        expect(raw).toContain("scope: project")
        expect(raw).toContain("agent: review")
      },
    })
  })
})
