import { expect, test } from "bun:test"
import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openContained } from "../src/contained-file.js"

test("checked bytes belong to the open handle, not a replacement directory entry", async () => {
  const temp = await mkdtemp(join(tmpdir(), "contained-file-"))
  const root = join(await realpath(temp), "workspace")
  const folder = join(root, "reports")
  const other = join(temp, "other")
  try {
    await mkdir(folder, { recursive: true })
    await mkdir(other)
    await writeFile(join(folder, "page"), "first")
    await writeFile(join(other, "page"), "other")
    // A launcher-supplied environment is not authority to choose a DLL for the handle check.
    const systemRoot = process.env.SystemRoot
    const opened = await (async () => {
      if (process.platform !== "win32") return openContained(root, "reports/page")
      process.env.SystemRoot = other
      try {
        return await openContained(root, "reports/page")
      } finally {
        if (systemRoot === undefined) delete process.env.SystemRoot
        else process.env.SystemRoot = systemRoot
      }
    })()
    if (!opened) throw new Error("missing control")
    try {
      // Windows can move the file by name but will not rename a directory containing an open file.
      await rename(join(folder, "page"), join(root, "original"))
      await rm(folder, { recursive: true })
      await symlink(other, folder, process.platform === "win32" ? "junction" : "dir")
      expect(await opened.file.readFile("utf8")).toBe("first")
      expect(await openContained(root, "reports/page")).toBeUndefined()
    } finally {
      await opened.file.close()
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
