import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

const wintest = process.platform === "win32" ? test : test.skip

function withInstance(directory: string, fn: () => Promise<any>) {
  return Instance.provide({ directory, fn })
}

async function ready(name: string) {
  const { GlobalBus } = await import("../../src/bus/global")

  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", on)
      reject(new Error(`timed out waiting for worktree.ready: ${name}`))
    }, 30_000)

    function on(evt: { payload: { type: string; properties?: { name?: string } } }) {
      if (evt.payload.type !== Worktree.Event.Ready.type) return
      if (evt.payload.properties?.name !== name) return
      clearTimeout(timer)
      GlobalBus.off("event", on)
      resolve()
    }

    GlobalBus.on("event", on)
  })
}

async function make(root: string, name: string) {
  const wait = ready(name)
  const info = await withInstance(root, () => Worktree.create({ name }))
  await wait
  return info
}

describe("Worktree.reset", () => {
  afterEach(() => Instance.disposeAll())

  test("restores tracked files and removes untracked files", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const file = path.join(root, "README.md")
    await Bun.write(file, "# reset\n")
    await $`git add README.md`.cwd(root).quiet()
    await $`git commit -m "add readme"`.cwd(root).quiet()

    const info = await make(root, `reset-${Date.now().toString(36)}`)

    const readme = path.join(info.directory, "README.md")
    const extra = path.join(info.directory, `extra-${Date.now().toString(36)}.txt`)
    const text = await fs.readFile(readme, "utf8")
    await fs.writeFile(readme, `${text.trimEnd()}\nchange\n`, "utf8")
    await fs.writeFile(extra, "extra\n", "utf8")

    const ok = await withInstance(root, () => Worktree.reset({ directory: info.directory }))
    expect(ok).toBe(true)

    expect(await fs.readFile(readme, "utf8")).toBe(text)
    expect(await fs.stat(extra).then(() => true).catch(() => false)).toBe(false)
    expect((await $`git status --porcelain=v1`.cwd(info.directory).quiet().text()).trim()).toBe("")
  })

  test("retries transient clean failures", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const file = path.join(root, "README.md")
    await Bun.write(file, "# reset\n")
    await $`git add README.md`.cwd(root).quiet()
    await $`git commit -m "add readme"`.cwd(root).quiet()

    const info = await make(root, `reset-retry-${Date.now().toString(36)}`)

    const readme = path.join(info.directory, "README.md")
    const extra = path.join(info.directory, `extra-${Date.now().toString(36)}.txt`)
    const text = await fs.readFile(readme, "utf8")
    await fs.writeFile(readme, `${text.trimEnd()}\nchange\n`, "utf8")
    await fs.writeFile(extra, "extra\n", "utf8")

    const real = (await $`which git`.quiet().text()).trim()
    expect(real).toBeTruthy()

    const bin = path.join(root, "bin")
    const shim = path.join(bin, "git")
    const mark = path.join(root, "git-clean-once")
    await fs.mkdir(bin, { recursive: true })
    await Bun.write(
      shim,
      [
        "#!/bin/bash",
        `REAL_GIT=${JSON.stringify(real)}`,
        `MARK=${JSON.stringify(mark)}`,
        'if [ "$1" = "-c" ] && [ "$2" = "core.fsmonitor=false" ]; then',
        "  shift 2",
        "fi",
        'if [ "$1" = "clean" ] && [ ! -f "$MARK" ]; then',
        '  touch "$MARK"',
        '  echo "warning: failed to remove extra.txt: Permission denied" >&2',
        "  exit 1",
        "fi",
        'exec "$REAL_GIT" "$@"',
      ].join("\n"),
    )
    await fs.chmod(shim, 0o755)

    const prev = process.env.PATH ?? ""
    process.env.PATH = `${bin}${path.delimiter}${prev}`

    const ok = await (async () => {
      try {
        return await withInstance(root, () => Worktree.reset({ directory: info.directory }))
      } finally {
        process.env.PATH = prev
      }
    })()

    expect(ok).toBe(true)
    expect(await fs.readFile(readme, "utf8")).toBe(text)
    expect(await fs.stat(extra).then(() => true).catch(() => false)).toBe(false)
    expect(await fs.stat(mark).then(() => true).catch(() => false)).toBe(true)
    expect((await $`git status --porcelain=v1`.cwd(info.directory).quiet().text()).trim()).toBe("")
  })

  wintest("stops fsmonitor before resetting a worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const file = path.join(root, "README.md")
    await Bun.write(file, "# reset\n")
    await $`git add README.md`.cwd(root).quiet()
    await $`git commit -m "add readme"`.cwd(root).quiet()

    const info = await make(root, `reset-fsmonitor-${Date.now().toString(36)}`)

    const readme = path.join(info.directory, "README.md")
    const extra = path.join(info.directory, `extra-${Date.now().toString(36)}.txt`)
    const text = await fs.readFile(readme, "utf8")

    await $`git config core.fsmonitor true`.cwd(info.directory).quiet()
    await $`git fsmonitor--daemon stop`.cwd(info.directory).quiet().nothrow()
    await fs.writeFile(readme, `${text.trimEnd()}\nchange\n`, "utf8")
    await fs.writeFile(extra, "extra\n", "utf8")
    await $`git diff`.cwd(info.directory).quiet()

    const before = await $`git fsmonitor--daemon status`.cwd(info.directory).quiet().nothrow()
    expect(before.exitCode).toBe(0)

    const ok = await withInstance(root, () => Worktree.reset({ directory: info.directory }))
    expect(ok).toBe(true)

    expect(await fs.readFile(readme, "utf8")).toBe(text)
    expect(await fs.stat(extra).then(() => true).catch(() => false)).toBe(false)
    expect((await $`git status --porcelain=v1`.cwd(info.directory).quiet().text()).trim()).toBe("")
  })
})
