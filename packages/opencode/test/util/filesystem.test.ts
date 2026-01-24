import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { Filesystem } from "../../src/util/filesystem"

describe("util.filesystem", () => {
  test("exists() is true for files and directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.exists(dir), Filesystem.exists(file), Filesystem.exists(missing)])

    expect(cases).toEqual([true, true, false])

    await rm(tmp, { recursive: true, force: true })
  })

  test("isDir() is true only for directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.isDir(dir), Filesystem.isDir(file), Filesystem.isDir(missing)])

    expect(cases).toEqual([true, false, false])

    await rm(tmp, { recursive: true, force: true })
  })

  test("isDir() follows symlinks to directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const realDir = path.join(tmp, "real-dir")
    const symlinkDir = path.join(tmp, "symlink-dir")
    const realFile = path.join(tmp, "real-file.txt")
    const symlinkFile = path.join(tmp, "symlink-file.txt")
    const brokenLink = path.join(tmp, "broken-link")

    await mkdir(realDir, { recursive: true })
    await Bun.write(realFile, "content")
    await $`ln -s ${realDir} ${symlinkDir}`.quiet()
    await $`ln -s ${realFile} ${symlinkFile}`.quiet()
    await $`ln -s ${tmp}/nonexistent ${brokenLink}`.quiet()

    const cases = await Promise.all([
      Filesystem.isDir(realDir),
      Filesystem.isDir(symlinkDir),
      Filesystem.isDir(realFile),
      Filesystem.isDir(symlinkFile),
      Filesystem.isDir(brokenLink),
    ])

    expect(cases).toEqual([true, true, false, false, false])

    await rm(tmp, { recursive: true, force: true })
  })
})
