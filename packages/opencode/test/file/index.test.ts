import { afterEach, describe, test, expect } from "bun:test"
import { $ } from "bun"
import { Effect } from "effect"
import path from "path"
import fs from "fs/promises"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util"
import { provideInstance, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

const init = () => run(File.Service.use((svc) => svc.init()))
const run = <A, E>(eff: Effect.Effect<A, E, File.Service>) =>
  Effect.runPromise(provideInstance(Instance.directory)(eff.pipe(Effect.provide(File.defaultLayer))))
const status = () => run(File.Service.use((svc) => svc.status()))
const read = (file: string) => run(File.Service.use((svc) => svc.read(file)))
const list = (dir?: string) => run(File.Service.use((svc) => svc.list(dir)))
const search = (input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) =>
  run(File.Service.use((svc) => svc.search(input)))

describe("file/index Filesystem patterns", () => {
  describe("read() - text content", () => {
    test("reads text file via Filesystem.readText()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await fs.writeFile(filepath, "Hello World", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("test.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("Hello World")
        },
      })
    })

    test("reads with Filesystem.exists() check", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Non-existent file should return empty content
          const result = await read("nonexistent.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("")
        },
      })
    })

    test("trims whitespace from text content", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await fs.writeFile(filepath, "  content with spaces  \n\n", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("test.txt")
          expect(result.content).toBe("content with spaces")
        },
      })
    })

    test("handles empty text file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "empty.txt")
      await fs.writeFile(filepath, "", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("empty.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("")
        },
      })
    })

    test("handles multi-line text files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "multiline.txt")
      await fs.writeFile(filepath, "line1\nline2\nline3", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("multiline.txt")
          expect(result.content).toBe("line1\nline2\nline3")
        },
      })
    })
  })

  describe("read() - binary content", () => {
    test("reads binary file via Filesystem.readArrayBuffer()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "image.png")
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      await fs.writeFile(filepath, binaryContent)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("image.png")
          expect(result.type).toBe("text") // Images return as text with base64 encoding
          expect(result.encoding).toBe("base64")
          expect(result.mimeType).toBe("image/png")
          expect(result.content).toBe(binaryContent.toString("base64"))
        },
      })
    })

    test("returns empty for binary non-image files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "binary.so")
      await fs.writeFile(filepath, Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "binary")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("binary.so")
          expect(result.type).toBe("binary")
          expect(result.content).toBe("")
        },
      })
    })
  })

  describe("read() - Filesystem.mimeType()", () => {
    test("detects MIME type via Filesystem.mimeType()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.json")
      await fs.writeFile(filepath, '{"key": "value"}', "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(await Filesystem.mimeType(filepath)).toContain("application/json")

          const result = await read("test.json")
          expect(result.type).toBe("text")
        },
      })
    })

    test("handles various image MIME types", async () => {
      await using tmp = await tmpdir()
      const testCases = [
        { ext: "jpg", mime: "image/jpeg" },
        { ext: "png", mime: "image/png" },
        { ext: "gif", mime: "image/gif" },
        { ext: "webp", mime: "image/webp" },
      ]

      for (const { ext, mime } of testCases) {
        const filepath = path.join(tmp.path, `test.${ext}`)
        await fs.writeFile(filepath, Buffer.from([0x00, 0x00, 0x00, 0x00]), "binary")

        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(await Filesystem.mimeType(filepath)).toContain(mime)
          },
        })
      }
    })
  })

  describe("list() - Filesystem.exists() and readText()", () => {
    test("reads .gitignore via Filesystem.exists() and readText()", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const gitignorePath = path.join(tmp.path, ".gitignore")
          await fs.writeFile(gitignorePath, "node_modules\ndist\n", "utf-8")

          // This is used internally in list()
          expect(await Filesystem.exists(gitignorePath)).toBe(true)

          const content = await Filesystem.readText(gitignorePath)
          expect(content).toContain("node_modules")
        },
      })
    })

    test("reads .ignore file similarly", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ignorePath = path.join(tmp.path, ".ignore")
          await fs.writeFile(ignorePath, "*.log\n.env\n", "utf-8")

          expect(await Filesystem.exists(ignorePath)).toBe(true)
          expect(await Filesystem.readText(ignorePath)).toContain("*.log")
        },
      })
    })

    test("handles missing .gitignore gracefully", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const gitignorePath = path.join(tmp.path, ".gitignore")
          expect(await Filesystem.exists(gitignorePath)).toBe(false)

          // list() should still work
          const nodes = await list()
          expect(Array.isArray(nodes)).toBe(true)
        },
      })
    })
  })

  describe("File.changed() - Filesystem.readText() for untracked files", () => {
    test("reads untracked files via Filesystem.readText()", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const untrackedPath = path.join(tmp.path, "untracked.txt")
          await fs.writeFile(untrackedPath, "new content\nwith multiple lines", "utf-8")

          // This is how File.changed() reads untracked files
          const content = await Filesystem.readText(untrackedPath)
          const lines = content.split("\n").length
          expect(lines).toBe(2)
        },
      })
    })
  })

  describe("Error handling", () => {
    test("handles errors gracefully in Filesystem.readText()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "readonly.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nonExistentPath = path.join(tmp.path, "does-not-exist.txt")
          // Filesystem.readText() on non-existent file throws
          await expect(Filesystem.readText(nonExistentPath)).rejects.toThrow()

          // But read() handles this gracefully
          const result = await read("does-not-exist.txt")
          expect(result.content).toBe("")
        },
      })
    })

    test("handles errors in Filesystem.readArrayBuffer()", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nonExistentPath = path.join(tmp.path, "does-not-exist.bin")
          const buffer = await Filesystem.readArrayBuffer(nonExistentPath).catch(() => new ArrayBuffer(0))
          expect(buffer.byteLength).toBe(0)
        },
      })
    })

    test("returns empty array buffer on error for images", async () => {
      await using tmp = await tmpdir()
      const _filepath = path.join(tmp.path, "broken.png")
      // Don't create the file

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // read() handles missing images gracefully
          const result = await read("broken.png")
          expect(result.type).toBe("text")
          expect(result.content).toBe("")
        },
      })
    })
  })

  describe("shouldEncode() logic", () => {
    test("treats .ts files as text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.ts")
      await fs.writeFile(filepath, "export const value = 1", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("test.ts")
          expect(result.type).toBe("text")
          expect(result.content).toBe("export const value = 1")
        },
      })
    })

    test("treats .mts files as text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.mts")
      await fs.writeFile(filepath, "export const value = 1", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("test.mts")
          expect(result.type).toBe("text")
          expect(result.content).toBe("export const value = 1")
        },
      })
    })

    test("treats .sh files as text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.sh")
      await fs.writeFile(filepath, "#!/usr/bin/env bash\necho hello", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("test.sh")
          expect(result.type).toBe("text")
          expect(result.content).toBe("#!/usr/bin/env bash\necho hello")
        },
      })
    })

    test("treats Dockerfile as text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "Dockerfile")
      await fs.writeFile(filepath, "FROM alpine:3.20", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("Dockerfile")
          expect(result.type).toBe("text")
          expect(result.content).toBe("FROM alpine:3.20")
        },
      })
    })

    test("returns encoding info for text files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await fs.writeFile(filepath, "simple text", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("test.txt")
          expect(result.encoding).toBeUndefined()
          expect(result.type).toBe("text")
        },
      })
    })

    test("returns base64 encoding for images", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.jpg")
      await fs.writeFile(filepath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "binary")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("test.jpg")
          expect(result.encoding).toBe("base64")
          expect(result.mimeType).toBe("image/jpeg")
        },
      })
    })
  })

  describe("Path security", () => {
    test("throws for paths outside project directory", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(read("../outside.txt")).rejects.toThrow("Access denied")
        },
      })
    })

    test("throws for paths outside project directory", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(read("../outside.txt")).rejects.toThrow("Access denied")
        },
      })
    })
  })

  describe("status()", () => {
    test("detects modified file", async () => {
      await using tmp = await tmpdir({ git: true })
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "original\n", "utf-8")
      await $`git add .`.cwd(tmp.path).quiet()
      await $`git commit -m "add file"`.cwd(tmp.path).quiet()
      await fs.writeFile(filepath, "modified\nextra line\n", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await status()
          const entry = result.find((f) => f.path === "file.txt")
          expect(entry).toBeDefined()
          expect(entry!.status).toBe("modified")
          expect(entry!.added).toBeGreaterThan(0)
          expect(entry!.removed).toBeGreaterThan(0)
        },
      })
    })

    test("detects untracked file as added", async () => {
      await using tmp = await tmpdir({ git: true })
      await fs.writeFile(path.join(tmp.path, "new.txt"), "line1\nline2\nline3\n", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await status()
          const entry = result.find((f) => f.path === "new.txt")
          expect(entry).toBeDefined()
          expect(entry!.status).toBe("added")
          expect(entry!.added).toBe(4) // 3 lines + trailing newline splits to 4
          expect(entry!.removed).toBe(0)
        },
      })
    })

    test("detects deleted file", async () => {
      await using tmp = await tmpdir({ git: true })
      const filepath = path.join(tmp.path, "gone.txt")
      await fs.writeFile(filepath, "content\n", "utf-8")
      await $`git add .`.cwd(tmp.path).quiet()
      await $`git commit -m "add file"`.cwd(tmp.path).quiet()
      await fs.rm(filepath)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await status()
          // Deleted files appear in both numstat (as "modified") and diff-filter=D (as "deleted")
          const entries = result.filter((f) => f.path === "gone.txt")
          expect(entries.some((e) => e.status === "deleted")).toBe(true)
        },
      })
    })

    test("detects mixed changes", async () => {
      await using tmp = await tmpdir({ git: true })
      await fs.writeFile(path.join(tmp.path, "keep.txt"), "keep\n", "utf-8")
      await fs.writeFile(path.join(tmp.path, "remove.txt"), "remove\n", "utf-8")
      await $`git add .`.cwd(tmp.path).quiet()
      await $`git commit -m "initial"`.cwd(tmp.path).quiet()

      // Modify one, delete one, add one
      await fs.writeFile(path.join(tmp.path, "keep.txt"), "changed\n", "utf-8")
      await fs.rm(path.join(tmp.path, "remove.txt"))
      await fs.writeFile(path.join(tmp.path, "brand-new.txt"), "hello\n", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await status()
          expect(result.some((f) => f.path === "keep.txt" && f.status === "modified")).toBe(true)
          expect(result.some((f) => f.path === "remove.txt" && f.status === "deleted")).toBe(true)
          expect(result.some((f) => f.path === "brand-new.txt" && f.status === "added")).toBe(true)
        },
      })
    })

    test("returns empty for non-git project", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await status()
          expect(result).toEqual([])
        },
      })
    })

    test("returns empty for clean repo", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await status()
          expect(result).toEqual([])
        },
      })
    })

    test("parses binary numstat as 0", async () => {
      await using tmp = await tmpdir({ git: true })
      const filepath = path.join(tmp.path, "data.bin")
      // Write content with null bytes so git treats it as binary
      const binaryData = Buffer.alloc(256)
      for (let i = 0; i < 256; i++) binaryData[i] = i
      await fs.writeFile(filepath, binaryData)
      await $`git add .`.cwd(tmp.path).quiet()
      await $`git commit -m "add binary"`.cwd(tmp.path).quiet()
      // Modify the binary
      const modified = Buffer.alloc(512)
      for (let i = 0; i < 512; i++) modified[i] = i % 256
      await fs.writeFile(filepath, modified)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await status()
          const entry = result.find((f) => f.path === "data.bin")
          expect(entry).toBeDefined()
          expect(entry!.status).toBe("modified")
          expect(entry!.added).toBe(0)
          expect(entry!.removed).toBe(0)
        },
      })
    })
  })

  describe("list()", () => {
    test("returns files and directories with correct shape", async () => {
      await using tmp = await tmpdir({ git: true })
      await fs.mkdir(path.join(tmp.path, "subdir"))
      await fs.writeFile(path.join(tmp.path, "file.txt"), "content", "utf-8")
      await fs.writeFile(path.join(tmp.path, "subdir", "nested.txt"), "nested", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nodes = await list()
          expect(nodes.length).toBeGreaterThanOrEqual(2)
          for (const node of nodes) {
            expect(node).toHaveProperty("name")
            expect(node).toHaveProperty("path")
            expect(node).toHaveProperty("absolute")
            expect(node).toHaveProperty("type")
            expect(node).toHaveProperty("ignored")
            expect(["file", "directory"]).toContain(node.type)
          }
        },
      })
    })

    test("sorts directories before files, alphabetical within each", async () => {
      await using tmp = await tmpdir({ git: true })
      await fs.mkdir(path.join(tmp.path, "beta"))
      await fs.mkdir(path.join(tmp.path, "alpha"))
      await fs.writeFile(path.join(tmp.path, "zz.txt"), "", "utf-8")
      await fs.writeFile(path.join(tmp.path, "aa.txt"), "", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nodes = await list()
          const dirs = nodes.filter((n) => n.type === "directory")
          const files = nodes.filter((n) => n.type === "file")
          // Dirs come first
          const firstFile = nodes.findIndex((n) => n.type === "file")
          const lastDir = nodes.findLastIndex((n) => n.type === "directory")
          if (lastDir >= 0 && firstFile >= 0) {
            expect(lastDir).toBeLessThan(firstFile)
          }
          // Alphabetical within dirs
          expect(dirs.map((d) => d.name)).toEqual(dirs.map((d) => d.name).toSorted())
          // Alphabetical within files
          expect(files.map((f) => f.name)).toEqual(files.map((f) => f.name).toSorted())
        },
      })
    })

    test("excludes .git and .DS_Store", async () => {
      await using tmp = await tmpdir({ git: true })
      await fs.writeFile(path.join(tmp.path, ".DS_Store"), "", "utf-8")
      await fs.writeFile(path.join(tmp.path, "visible.txt"), "", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nodes = await list()
          const names = nodes.map((n) => n.name)
          expect(names).not.toContain(".git")
          expect(names).not.toContain(".DS_Store")
          expect(names).toContain("visible.txt")
        },
      })
    })

    test("marks gitignored files as ignored", async () => {
      await using tmp = await tmpdir({ git: true })
      await fs.writeFile(path.join(tmp.path, ".gitignore"), "*.log\nbuild/\n", "utf-8")
      await fs.writeFile(path.join(tmp.path, "app.log"), "log data", "utf-8")
      await fs.writeFile(path.join(tmp.path, "main.ts"), "code", "utf-8")
      await fs.mkdir(path.join(tmp.path, "build"))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nodes = await list()
          const logNode = nodes.find((n) => n.name === "app.log")
          const tsNode = nodes.find((n) => n.name === "main.ts")
          const buildNode = nodes.find((n) => n.name === "build")
          expect(logNode?.ignored).toBe(true)
          expect(tsNode?.ignored).toBe(false)
          expect(buildNode?.ignored).toBe(true)
        },
      })
    })

    test("lists subdirectory contents", async () => {
      await using tmp = await tmpdir({ git: true })
      await fs.mkdir(path.join(tmp.path, "sub"))
      await fs.writeFile(path.join(tmp.path, "sub", "a.txt"), "", "utf-8")
      await fs.writeFile(path.join(tmp.path, "sub", "b.txt"), "", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nodes = await list("sub")
          expect(nodes.length).toBe(2)
          expect(nodes.map((n) => n.name).sort()).toEqual(["a.txt", "b.txt"])
          // Paths should be relative to project root (normalize for Windows)
          expect(nodes[0].path.replaceAll("\\", "/").startsWith("sub/")).toBe(true)
        },
      })
    })

    test("throws for paths outside project directory", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(list("../outside")).rejects.toThrow("Access denied")
        },
      })
    })

    test("works without git", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "file.txt"), "hi", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nodes = await list()
          expect(nodes.length).toBeGreaterThanOrEqual(1)
          // Without git, ignored should be false for all
          for (const node of nodes) {
            expect(node.ignored).toBe(false)
          }
        },
      })
    })
  })

  describe("search()", () => {
    async function setupSearchableRepo() {
      const tmp = await tmpdir({ git: true })
      await fs.writeFile(path.join(tmp.path, "index.ts"), "code", "utf-8")
      await fs.writeFile(path.join(tmp.path, "utils.ts"), "utils", "utf-8")
      await fs.writeFile(path.join(tmp.path, "readme.md"), "readme", "utf-8")
      await fs.mkdir(path.join(tmp.path, "src"))
      await fs.mkdir(path.join(tmp.path, ".hidden"))
      await fs.writeFile(path.join(tmp.path, "src", "main.ts"), "main", "utf-8")
      await fs.writeFile(path.join(tmp.path, ".hidden", "secret.ts"), "secret", "utf-8")
      return tmp
    }

    test("empty query returns files", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()

          const result = await search({ query: "", type: "file" })
          expect(result.length).toBeGreaterThan(0)
        },
      })
    })

    test("search works before explicit init", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await search({ query: "main", type: "file" })
          expect(result.some((f) => f.includes("main"))).toBe(true)
        },
      })
    })

    test("empty query returns dirs sorted with hidden last", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()

          const result = await search({ query: "", type: "directory" })
          expect(result.length).toBeGreaterThan(0)
          // Find first hidden dir index
          const firstHidden = result.findIndex((d) => d.split("/").some((p) => p.startsWith(".") && p.length > 1))
          const lastVisible = result.findLastIndex((d) => !d.split("/").some((p) => p.startsWith(".") && p.length > 1))
          if (firstHidden >= 0 && lastVisible >= 0) {
            expect(firstHidden).toBeGreaterThan(lastVisible)
          }
        },
      })
    })

    test("fuzzy matches file names", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()

          const result = await search({ query: "main", type: "file" })
          expect(result.some((f) => f.includes("main"))).toBe(true)
        },
      })
    })

    test("type filter returns only files", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()

          const result = await search({ query: "", type: "file" })
          // Files don't end with /
          for (const f of result) {
            expect(f.endsWith("/")).toBe(false)
          }
        },
      })
    })

    test("type filter returns only directories", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()

          const result = await search({ query: "", type: "directory" })
          // Directories end with /
          for (const d of result) {
            expect(d.endsWith("/")).toBe(true)
          }
        },
      })
    })

    test("respects limit", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()

          const result = await search({ query: "", type: "file", limit: 2 })
          expect(result.length).toBeLessThanOrEqual(2)
        },
      })
    })

    test("query starting with dot prefers hidden files", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()

          const result = await search({ query: ".hidden", type: "directory" })
          expect(result.length).toBeGreaterThan(0)
          expect(result[0]).toContain(".hidden")
        },
      })
    })

    test("search refreshes after init when files change", async () => {
      await using tmp = await setupSearchableRepo()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()
          expect(await search({ query: "fresh", type: "file" })).toEqual([])

          await fs.writeFile(path.join(tmp.path, "fresh.ts"), "fresh", "utf-8")

          const result = await search({ query: "fresh", type: "file" })
          expect(result).toContain("fresh.ts")
        },
      })
    })
  })

  describe("read() - diff/patch", () => {
    test("returns diff and patch for modified tracked file", async () => {
      await using tmp = await tmpdir({ git: true })
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "original content\n", "utf-8")
      await $`git add .`.cwd(tmp.path).quiet()
      await $`git commit -m "add file"`.cwd(tmp.path).quiet()
      await fs.writeFile(filepath, "modified content\n", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("file.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("modified content")
          expect(result.diff).toBeDefined()
          expect(result.diff).toContain("original content")
          expect(result.diff).toContain("modified content")
          expect(result.patch).toBeDefined()
          expect(result.patch!.hunks.length).toBeGreaterThan(0)
        },
      })
    })

    test("returns diff for staged changes", async () => {
      await using tmp = await tmpdir({ git: true })
      const filepath = path.join(tmp.path, "staged.txt")
      await fs.writeFile(filepath, "before\n", "utf-8")
      await $`git add .`.cwd(tmp.path).quiet()
      await $`git commit -m "add file"`.cwd(tmp.path).quiet()
      await fs.writeFile(filepath, "after\n", "utf-8")
      await $`git add .`.cwd(tmp.path).quiet()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("staged.txt")
          expect(result.diff).toBeDefined()
          expect(result.patch).toBeDefined()
        },
      })
    })

    test("returns no diff for unmodified file", async () => {
      await using tmp = await tmpdir({ git: true })
      const filepath = path.join(tmp.path, "clean.txt")
      await fs.writeFile(filepath, "unchanged\n", "utf-8")
      await $`git add .`.cwd(tmp.path).quiet()
      await $`git commit -m "add file"`.cwd(tmp.path).quiet()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await read("clean.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("unchanged")
          expect(result.diff).toBeUndefined()
          expect(result.patch).toBeUndefined()
        },
      })
    })
  })

  describe("InstanceState isolation", () => {
    test("two directories get independent file caches", async () => {
      await using one = await tmpdir({ git: true })
      await using two = await tmpdir({ git: true })
      await fs.writeFile(path.join(one.path, "a.ts"), "one", "utf-8")
      await fs.writeFile(path.join(two.path, "b.ts"), "two", "utf-8")

      await Instance.provide({
        directory: one.path,
        fn: async () => {
          await init()
          const results = await search({ query: "a.ts", type: "file" })
          expect(results).toContain("a.ts")
          const results2 = await search({ query: "b.ts", type: "file" })
          expect(results2).not.toContain("b.ts")
        },
      })

      await Instance.provide({
        directory: two.path,
        fn: async () => {
          await init()
          const results = await search({ query: "b.ts", type: "file" })
          expect(results).toContain("b.ts")
          const results2 = await search({ query: "a.ts", type: "file" })
          expect(results2).not.toContain("a.ts")
        },
      })
    })

    test("disposal gives fresh state on next access", async () => {
      await using tmp = await tmpdir({ git: true })
      await fs.writeFile(path.join(tmp.path, "before.ts"), "before", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()
          const results = await search({ query: "before", type: "file" })
          expect(results).toContain("before.ts")
        },
      })

      await Instance.disposeAll()

      await fs.writeFile(path.join(tmp.path, "after.ts"), "after", "utf-8")
      await fs.rm(path.join(tmp.path, "before.ts"))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await init()
          const results = await search({ query: "after", type: "file" })
          expect(results).toContain("after.ts")
          const stale = await search({ query: "before", type: "file" })
          expect(stale).not.toContain("before.ts")
        },
      })
    })
  })
})
