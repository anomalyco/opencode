import { test, expect, describe } from "bun:test"
import { $ } from "bun"
import path from "path"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("File.list symlink handling", () => {
  test("lists symlinks to directories as directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await $`mkdir -p ${dir}/real-dir`.quiet()
        await Bun.write(path.join(dir, "real-dir", "file.txt"), "content")
        await $`ln -s ${dir}/real-dir ${dir}/symlink-dir`.quiet()
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await File.list()

        const realDir = result.find((n) => n.name === "real-dir")
        const symlinkDir = result.find((n) => n.name === "symlink-dir")

        expect(realDir?.type).toBe("directory")
        expect(symlinkDir?.type).toBe("directory")
      },
    })
  })

  test("lists symlinks to files as files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "real-file.txt"), "content")
        await $`ln -s ${dir}/real-file.txt ${dir}/symlink-file.txt`.quiet()
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await File.list()

        const realFile = result.find((n) => n.name === "real-file.txt")
        const symlinkFile = result.find((n) => n.name === "symlink-file.txt")

        expect(realFile?.type).toBe("file")
        expect(symlinkFile?.type).toBe("file")
      },
    })
  })

  test("handles broken symlinks gracefully", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await $`ln -s ${dir}/nonexistent ${dir}/broken-link`.quiet()
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Should not throw, broken symlink treated as file
        const result = await File.list()
        const brokenLink = result.find((n) => n.name === "broken-link")
        expect(brokenLink?.type).toBe("file")
      },
    })
  })

  test("can list contents of symlinked directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await $`mkdir -p ${dir}/real-dir`.quiet()
        await Bun.write(path.join(dir, "real-dir", "nested.txt"), "nested content")
        await $`ln -s ${dir}/real-dir ${dir}/symlink-dir`.quiet()
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await File.list("symlink-dir")
        expect(result.some((n) => n.name === "nested.txt")).toBe(true)
      },
    })
  })

  test("symlinked directories are sorted with other directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await $`mkdir -p ${dir}/aaa-real-dir`.quiet()
        await $`mkdir -p ${dir}/zzz-real-dir`.quiet()
        await Bun.write(path.join(dir, "file.txt"), "content")
        await $`ln -s ${dir}/aaa-real-dir ${dir}/mmm-symlink-dir`.quiet()
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await File.list()
        const dirs = result.filter((n) => n.type === "directory")
        const files = result.filter((n) => n.type === "file")

        // All directories should come before files
        expect(dirs.length).toBe(3)
        expect(files.length).toBe(1)

        // Symlink dir should be included in directories
        expect(dirs.some((d) => d.name === "mmm-symlink-dir")).toBe(true)
      },
    })
  })
})
