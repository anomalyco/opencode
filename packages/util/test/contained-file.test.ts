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

test("a runtime that cannot name an open handle refuses the read instead of trusting the path", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "contained-file-")))
  try {
    await writeFile(join(root, "page"), "first")
    const control = await openContained(root, "page")
    if (!control) throw new Error("missing control")
    await control.file.close()

    // workerd resolves `#handle-path` to its build, which has no kernel name for a descriptor.
    const child = Bun.spawn(
      [
        process.execPath,
        "--conditions=workerd",
        "-e",
        `const { openContained } = await import(${JSON.stringify(join(import.meta.dir, "../src/contained-file.ts"))})
for (const path of ["page", "page", "missing"]) {
  try { await openContained(${JSON.stringify(root)}, path); process.exit(1) }
  catch (error) { console.log(error._tag ?? error.code) }
}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])

    expect(stderr.trim().split(/\r?\n/)).toEqual([expect.stringContaining("file_verification_unavailable")])
    expect(stdout.trim().split(/\r?\n/)).toEqual(["file_verification_unavailable", "file_verification_unavailable", "ENOENT"])
    expect(await child.exited).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
