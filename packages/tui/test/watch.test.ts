import { expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileWatchDirs, safeWatch, watchFile } from "../src/util/watch"

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

test("follows a symlink that is created or repointed while watching", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "tui-watch-")))
  try {
    const link = path.join(root, "config", "cli.json")
    const first = path.join(root, "one", "cli.json")
    const second = path.join(root, "two", "cli.json")
    await Bun.write(link, "{}")
    await Bun.write(first, "{}")
    await Bun.write(second, "{}")

    let calls = 0
    const watcher = watchFile(link, () => calls++)
    expect(watcher.dirs()).toEqual([path.dirname(link)])

    // Replace the regular file with a symlink, as a dotfiles manager would.
    await rm(link)
    await symlink(first, link)
    await waitFor(() => watcher.dirs().includes(path.dirname(first)))

    // Repoint the link to a different directory.
    await rm(link)
    await symlink(second, link)
    await waitFor(() => watcher.dirs().includes(path.dirname(second)))
    expect(watcher.dirs()).not.toContain(path.dirname(first))

    const before = calls
    await Bun.sleep(100); await writeFile(second, "{\"a\":1}")
    await waitFor(() => calls > before)
    watcher.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("keeps watching the target directory after the target is deleted and recreated", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "tui-watch-")))
  try {
    const target = path.join(root, "dotfiles", "cli.json")
    const link = path.join(root, "config", "cli.json")
    await Bun.write(target, "{}")
    await mkdir(path.dirname(link), { recursive: true })
    await symlink(target, link)

    let calls = 0
    const watcher = watchFile(link, () => calls++)
    expect(watcher.dirs()).toContain(path.dirname(target))

    await rm(target)
    await Bun.sleep(300)
    expect(watcher.dirs()).toContain(path.dirname(target))

    const before = calls
    await writeFile(target, '{"a":1}')
    await waitFor(() => calls > before)
    watcher.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error("condition not met")
}
