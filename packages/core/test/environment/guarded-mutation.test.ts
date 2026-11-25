import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/tmpdir"
import { readWorkspaceBytes, replaceWorkspaceFile } from "../../src/environment/guarded-mutation"

describe.skipIf(process.platform !== "linux")("guarded workspace mutation", () => {
  test("creates parents and atomically replaces an existing file", async () => {
    await using directory = await tmpdir()
    const first = await replaceWorkspaceFile(
      directory.path,
      "nested/file.txt",
      new TextEncoder().encode("first"),
      async () => {},
    )
    expect(first.existed).toBe(false)
    expect((await fs.stat(path.join(directory.path, "nested/file.txt"))).mode & 0o777).toBe(0o666 & ~process.umask())
    const second = await replaceWorkspaceFile(
      directory.path,
      "nested/file.txt",
      new TextEncoder().encode("second"),
      async () => {},
    )
    expect(second.existed).toBe(true)
    expect(new TextDecoder().decode(await readWorkspaceBytes(directory.path, "nested/file.txt"))).toBe("second")
    await fs.chmod(path.join(directory.path, "nested/file.txt"), 0o755)
    await replaceWorkspaceFile(directory.path, "nested/file.txt", new TextEncoder().encode("third"), async () => {})
    expect((await fs.stat(path.join(directory.path, "nested/file.txt"))).mode & 0o777).toBe(0o755)
  })

  test("refuses symlink traversal and leaves an outside file unchanged", async () => {
    await using directory = await tmpdir()
    await using outside = await tmpdir()
    await fs.writeFile(path.join(outside.path, "victim"), "safe")
    await fs.symlink(outside.path, path.join(directory.path, "alias"))
    await expect(
      replaceWorkspaceFile(directory.path, "alias/victim", new TextEncoder().encode("changed"), async () => {}),
    ).rejects.toThrow()
    expect(await fs.readFile(path.join(outside.path, "victim"), "utf8")).toBe("safe")
  })

  test("refuses hardlinked existing files without mutating their inode", async () => {
    await using directory = await tmpdir()
    await using outside = await tmpdir()
    await fs.writeFile(path.join(outside.path, "victim"), "safe")
    await fs.link(path.join(outside.path, "victim"), path.join(directory.path, "linked"))
    await expect(
      replaceWorkspaceFile(directory.path, "linked", new TextEncoder().encode("changed"), async () => {}),
    ).rejects.toThrow()
    expect(await fs.readFile(path.join(outside.path, "victim"), "utf8")).toBe("safe")
  })

  test("refuses Git metadata paths", async () => {
    await using directory = await tmpdir()
    await expect(
      replaceWorkspaceFile(directory.path, ".git/config", new TextEncoder().encode("changed"), async () => {}),
    ).rejects.toThrow()
    await expect(fs.stat(path.join(directory.path, ".git"))).rejects.toThrow()
  })

  test("revoked assignment creates no parent directory", async () => {
    await using directory = await tmpdir()
    await expect(
      replaceWorkspaceFile(directory.path, "nested/new.txt", new TextEncoder().encode("changed"), async () => {
        throw new Error("assignment revoked")
      }),
    ).rejects.toThrow("assignment revoked")
    await expect(fs.stat(path.join(directory.path, "nested"))).rejects.toThrow()
  })
})
