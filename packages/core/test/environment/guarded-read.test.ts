import { describe, expect, test } from "bun:test"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { openWorkspaceFile } from "../../src/environment/guarded-read"
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

test.skipIf(process.platform === "linux")("guarded reads fail closed without Linux proc fds", async () => {
  await using tmp = await tmpdir()
  await writeFile(join(tmp.path, "file.txt"), "hello")
  await expect(openWorkspaceFile(tmp.path, "file.txt")).rejects.toThrow("require Linux")
})
