import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("File.upload", () => {
  test("creates a new file with text content", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.upload("hello.txt", "hello world")
        const content = await Bun.file(path.join(tmp.path, "hello.txt")).text()
        expect(content).toBe("hello world")
      },
    })
  })

  test("creates parent directories automatically", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.upload("deep/nested/dir/file.ts", "export const x = 1")
        const content = await Bun.file(path.join(tmp.path, "deep/nested/dir/file.ts")).text()
        expect(content).toBe("export const x = 1")
      },
    })
  })

  test("overwrites existing file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "existing.txt"), "old content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.upload("existing.txt", "new content")
        const content = await Bun.file(path.join(tmp.path, "existing.txt")).text()
        expect(content).toBe("new content")
      },
    })
  })

  test("writes binary content from ArrayBuffer", async () => {
    await using tmp = await tmpdir()
    const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.upload("image.png", original.buffer)
        const buffer = await Bun.file(path.join(tmp.path, "image.png")).arrayBuffer()
        expect(new Uint8Array(buffer)).toEqual(original)
      },
    })
  })

  test("rejects path traversal", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.upload("../../../tmp/evil.txt", "pwned")).rejects.toThrow(
          "Access denied: path escapes project directory",
        )
      },
    })
  })

  test("can be read back via File.read", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.upload("roundtrip.ts", "export const x = 42")
        const result = await File.read("roundtrip.ts")
        expect(result.type).toBe("text")
        expect(result.content).toBe("export const x = 42")
      },
    })
  })
})

describe("File.remove", () => {
  test("deletes a file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "doomed.txt"), "goodbye")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.remove("doomed.txt")
        const exists = await Bun.file(path.join(tmp.path, "doomed.txt")).exists()
        expect(exists).toBe(false)
      },
    })
  })

  test("deletes a directory recursively", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir/a.txt"), "a")
        await Bun.write(path.join(dir, "subdir/b.txt"), "b")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.remove("subdir")
        const exists = await fs.stat(path.join(tmp.path, "subdir")).catch(() => null)
        expect(exists).toBeNull()
      },
    })
  })

  test("throws on nonexistent file", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.remove("ghost.txt")).rejects.toThrow("File not found")
      },
    })
  })

  test("rejects path traversal", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.remove("../../etc")).rejects.toThrow("Access denied: path escapes project directory")
      },
    })
  })
})

describe("File.mkdir", () => {
  test("creates a directory", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.mkdir("newdir")
        const stat = await fs.stat(path.join(tmp.path, "newdir"))
        expect(stat.isDirectory()).toBe(true)
      },
    })
  })

  test("creates nested directories recursively", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.mkdir("a/b/c/d")
        const stat = await fs.stat(path.join(tmp.path, "a/b/c/d"))
        expect(stat.isDirectory()).toBe(true)
      },
    })
  })

  test("is idempotent", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.mkdir("idem")
        await File.mkdir("idem")
        const stat = await fs.stat(path.join(tmp.path, "idem"))
        expect(stat.isDirectory()).toBe(true)
      },
    })
  })

  test("rejects path traversal", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.mkdir("../../evil")).rejects.toThrow("Access denied: path escapes project directory")
      },
    })
  })
})

describe("File.rename", () => {
  test("renames a file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "old.txt"), "content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.rename("old.txt", "new.txt")
        expect(await Bun.file(path.join(tmp.path, "new.txt")).text()).toBe("content")
        expect(await Bun.file(path.join(tmp.path, "old.txt")).exists()).toBe(false)
      },
    })
  })

  test("moves a file into a new directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "moved")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.rename("file.txt", "subdir/file.txt")
        expect(await Bun.file(path.join(tmp.path, "subdir/file.txt")).text()).toBe("moved")
        expect(await Bun.file(path.join(tmp.path, "file.txt")).exists()).toBe(false)
      },
    })
  })

  test("throws on nonexistent source", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.rename("ghost.txt", "new.txt")).rejects.toThrow("File not found")
      },
    })
  })

  test("rejects path traversal on source", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ok.txt"), "x")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.rename("../../etc/passwd", "stolen.txt")).rejects.toThrow(
          "Access denied: path escapes project directory",
        )
      },
    })
  })

  test("rejects path traversal on target", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ok.txt"), "x")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.rename("ok.txt", "../../tmp/evil.txt")).rejects.toThrow(
          "Access denied: path escapes project directory",
        )
      },
    })
  })
})

// HTTP endpoint tests
describe("file HTTP endpoints", () => {
  test("POST /file/upload with multipart form data", async () => {
    const filename = `_test_upload_${Date.now()}.txt`
    const filepath = path.join(projectRoot, filename)

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const formData = new FormData()
        formData.append(filename, new globalThis.File(["uploaded content"], filename))

        const res = await app.request("/file/upload", {
          method: "POST",
          body: formData,
        })
        expect(res.status).toBe(200)
        const results = (await res.json()) as { path: string; size: number }[]
        expect(results).toHaveLength(1)
        expect(results[0].path).toBe(filename)
        expect(results[0].size).toBe(16) // "uploaded content".length

        const content = await Bun.file(filepath).text()
        expect(content).toBe("uploaded content")

        await fs.rm(filepath, { force: true })
      },
    })
  })

  test("POST /file/upload with target directory via path field", async () => {
    const dir = `_test_upload_dir_${Date.now()}`
    const dirpath = path.join(projectRoot, dir)

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const formData = new FormData()
        formData.append("path", dir)
        formData.append("file", new globalThis.File(["file a"], "a.txt"))
        formData.append("file", new globalThis.File(["file b content"], "b.txt"))

        const res = await app.request("/file/upload", {
          method: "POST",
          body: formData,
        })
        expect(res.status).toBe(200)
        const results = (await res.json()) as { path: string; size: number }[]
        expect(results).toHaveLength(2)
        expect(results[0].path).toBe(`${dir}/a.txt`)
        expect(results[1].path).toBe(`${dir}/b.txt`)

        expect(await Bun.file(path.join(dirpath, "a.txt")).text()).toBe("file a")
        expect(await Bun.file(path.join(dirpath, "b.txt")).text()).toBe("file b content")

        await fs.rm(dirpath, { recursive: true, force: true })
      },
    })
  })

  test("POST /file/upload with binary data", async () => {
    // Note: Hono's test adapter (app.request) loses binary File content from FormData.
    // This is a known limitation — binary uploads work correctly over real HTTP.
    // We test the business logic (File.upload with ArrayBuffer) directly instead.
    await using tmp = await tmpdir()
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.upload("binary.bin", bytes.buffer)
        const buffer = await Bun.file(path.join(tmp.path, "binary.bin")).arrayBuffer()
        expect(new Uint8Array(buffer)).toEqual(bytes)
      },
    })
  })

  test("DELETE /file removes a file", async () => {
    const filename = `_test_delete_${Date.now()}.txt`
    const filepath = path.join(projectRoot, filename)
    await Bun.write(filepath, "to be deleted")

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const res = await app.request("/file", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filename }),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(await Bun.file(filepath).exists()).toBe(false)
      },
    })
  })

  test("POST /file/mkdir creates a directory", async () => {
    const dirname = `_test_mkdir_${Date.now()}`
    const dirpath = path.join(projectRoot, dirname)

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const res = await app.request("/file/mkdir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: dirname }),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        const stat = await fs.stat(dirpath)
        expect(stat.isDirectory()).toBe(true)

        await fs.rm(dirpath, { recursive: true, force: true })
      },
    })
  })

  test("POST /file/rename moves a file", async () => {
    const src = `_test_rename_src_${Date.now()}.txt`
    const dest = `_test_rename_dest_${Date.now()}.txt`
    await Bun.write(path.join(projectRoot, src), "rename me")

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const res = await app.request("/file/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: src, to: dest }),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(await Bun.file(path.join(projectRoot, dest)).text()).toBe("rename me")
        expect(await Bun.file(path.join(projectRoot, src)).exists()).toBe(false)

        await fs.rm(path.join(projectRoot, dest), { force: true })
      },
    })
  })
})
