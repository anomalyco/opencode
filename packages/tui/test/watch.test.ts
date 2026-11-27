import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileWatchDirs, safeWatch } from "../src/util/watch"

test("watches the target directory of a symlinked file", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "tui-watch-")))
  try {
    const target = path.join(root, "dotfiles", "cli.json")
    const link = path.join(root, "config", "cli.json")
    await Bun.write(target, "{}")
    await Bun.write(path.join(root, "config", ".keep"), "")
    await symlink(target, link)

    expect(fileWatchDirs(link)).toEqual([path.dirname(link), path.dirname(target)])

    const changed = new Promise<void>((resolve) => {
      const watchers = fileWatchDirs(link).map((dir) =>
        safeWatch(dir, () => {
          watchers.forEach((watcher) => watcher?.close())
          resolve()
        }),
      )
    })
    await writeFile(target, '{"tabs":{"mode":"off"}}')
    await changed
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("watches only the file directory when the file is not a symlink or is missing", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "tui-watch-")))
  try {
    const file = path.join(root, "cli.json")
    expect(fileWatchDirs(file)).toEqual([root])
    await writeFile(file, "{}")
    expect(fileWatchDirs(file)).toEqual([root])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
