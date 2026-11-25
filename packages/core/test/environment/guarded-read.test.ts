import { describe, expect, test } from "bun:test"
import { mkdir, rename, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { openWorkspaceDirectory, openWorkspaceFile } from "../../src/environment/guarded-read"
import { tmpdir } from "../fixture/tmpdir"

describe.skipIf(process.platform !== "linux")("openWorkspaceFile", () => {
  test("opens an ordinary nested file", async () => {
    await using tmp = await tmpdir()
    await mkdir(join(tmp.path, "nested"))
    await writeFile(join(tmp.path, "nested", "file.txt"), "hello")

    const file = await openWorkspaceFile(tmp.path, "nested/file.txt")
    try {
      expect(await file.readFile({ encoding: "utf8" })).toBe("hello")
    } finally {
      await file.close()
    }
  })

  test("rejects symlinks in parent and leaf segments", async () => {
    await using tmp = await tmpdir()
    await mkdir(join(tmp.path, "actual"))
    await writeFile(join(tmp.path, "actual", "file.txt"), "hello")
    await symlink("actual", join(tmp.path, "linked-directory"))
    await symlink("actual/file.txt", join(tmp.path, "linked-file"))

    await expect(openWorkspaceFile(tmp.path, "linked-directory/file.txt")).rejects.toThrow()
    await expect(openWorkspaceFile(tmp.path, "linked-file")).rejects.toThrow()
  })

  test("rejects directories, missing files, and invalid relative paths", async () => {
    await using tmp = await tmpdir()
    await mkdir(join(tmp.path, "directory"))

    await expect(openWorkspaceFile(tmp.path, "directory")).rejects.toThrow("not a regular file")
    await expect(openWorkspaceFile(tmp.path, "missing")).rejects.toThrow()
    for (const relative of ["", "/directory", "directory/", "directory//file", ".", "../file", "directory/../file"]) {
      await expect(openWorkspaceFile(tmp.path, relative)).rejects.toThrow("relative child segments")
    }
  })

  test("requires a canonical physical root", async () => {
    await using tmp = await tmpdir()
    await writeFile(join(tmp.path, "file.txt"), "hello")
    await symlink(".", join(tmp.path, "root-link"))

    await expect(openWorkspaceFile(join(tmp.path, "root-link"), "file.txt")).rejects.toThrow("canonical")
    await expect(openWorkspaceFile(`${tmp.path}/`, "file.txt")).rejects.toThrow("canonical")
  })
})

describe.skipIf(process.platform !== "linux")("openWorkspaceDirectory", () => {
  test("enumerates the root and a nested directory through retained descriptors", async () => {
    await using tmp = await tmpdir()
    await mkdir(join(tmp.path, "nested"))
    await writeFile(join(tmp.path, "nested", "file.txt"), "hello")
    await symlink("nested", join(tmp.path, "linked"))

    const root = await openWorkspaceDirectory(tmp.path, "")
    const nested = await openWorkspaceDirectory(tmp.path, "nested")
    try {
      expect((await root.readEntries()).map((entry) => [entry.name, entry.isSymbolicLink()])).toEqual([
        ["linked", true],
        ["nested", false],
      ])
      expect((await nested.readEntries()).map((entry) => entry.name)).toEqual(["file.txt"])
      expect(nested.childPath).toMatch(new RegExp(`^/proc/${process.pid}/fd/[0-9]+$`))
      const child = Bun.spawn([process.execPath, "-e", "console.log(require('node:fs').readdirSync(process.argv[1]).join(','))", nested.childPath], {
        stdout: "pipe",
      })
      expect(await new Response(child.stdout).text()).toBe("file.txt\n")
      expect(await child.exited).toBe(0)
    } finally {
      await nested.close()
      await root.close()
    }
    await expect(nested.readEntries()).rejects.toThrow("closed")
  })

  test("rejects symlink traversal, malformed paths, and noncanonical roots", async () => {
    await using tmp = await tmpdir()
    await mkdir(join(tmp.path, "actual"))
    await symlink("actual", join(tmp.path, "linked"))

    await expect(openWorkspaceDirectory(tmp.path, "linked")).rejects.toThrow()
    for (const relative of ["/actual", "actual/", "actual//child", ".", "..", "actual/../child", "actual\0bad"]) {
      await expect(openWorkspaceDirectory(tmp.path, relative)).rejects.toThrow("relative child segments")
    }
    await expect(openWorkspaceDirectory(`${tmp.path}/`, "")).rejects.toThrow("canonical")
    await expect(openWorkspaceDirectory(join(tmp.path, "linked"), "")).rejects.toThrow("canonical")
  })

  test("rejects enumeration after the opened directory moves", async () => {
    await using tmp = await tmpdir()
    await mkdir(join(tmp.path, "nested"))
    const directory = await openWorkspaceDirectory(tmp.path, "nested")
    try {
      await rename(join(tmp.path, "nested"), join(tmp.path, "moved"))
      await expect(directory.readEntries()).rejects.toThrow("changed during open")
    } finally {
      await directory.close()
    }
  })
})

test.skipIf(process.platform === "linux")("guarded reads fail closed without Linux proc fds", async () => {
  await using tmp = await tmpdir()
  await writeFile(join(tmp.path, "file.txt"), "hello")
  await expect(openWorkspaceFile(tmp.path, "file.txt")).rejects.toThrow("require Linux")
})
