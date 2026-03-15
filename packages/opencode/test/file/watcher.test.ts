import { $ } from "bun"
import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"

process.env.OPENCODE_EXPERIMENTAL_FILEWATCHER = "true"
delete process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER

async function load() {
  const { runPromiseInstance } = await import("../../src/effect/runtime")
  const watcher = await import("../../src/file/watcher")
  const { GlobalBus } = await import("../../src/bus/global")
  const { Instance } = await import("../../src/project/instance")

  return {
    GlobalBus,
    FileWatcher: watcher.FileWatcher,
    FileWatcherService: watcher.FileWatcherService,
    Instance,
    runPromiseInstance,
  }
}

async function start(directory: string) {
  const { FileWatcherService, Instance, runPromiseInstance } = await load()
  await Instance.provide({
    directory,
    fn: () => runPromiseInstance(FileWatcherService.use((service) => service.init())),
  })
  await Bun.sleep(100)
}

async function stop(directory: string) {
  const { Instance } = await load()
  await Instance.provide({
    directory,
    fn: () => Instance.dispose(),
  })
  await Bun.sleep(100)
}

async function nextUpdate(
  directory: string,
  check: (evt: { file: string; event: "add" | "change" | "unlink" }) => boolean,
  run: () => Promise<void>,
) {
  const { FileWatcher, GlobalBus } = await load()

  return await new Promise<{ file: string; event: "add" | "change" | "unlink" }>((resolve, reject) => {
    const on = (evt: {
      directory?: string
      payload: {
        type: string
        properties: {
          file: string
          event: "add" | "change" | "unlink"
        }
      }
    }) => {
      if (evt.directory !== directory) return
      if (evt.payload.type !== FileWatcher.Event.Updated.type) return
      if (!check(evt.payload.properties)) return
      clearTimeout(timeout)
      GlobalBus.off("event", on)
      resolve(evt.payload.properties)
    }

    const timeout = setTimeout(() => {
      GlobalBus.off("event", on)
      reject(new Error("timed out waiting for file watcher event"))
    }, 5000)

    GlobalBus.on("event", on)

    run().catch((err) => {
      clearTimeout(timeout)
      GlobalBus.off("event", on)
      reject(err)
    })
  })
}

afterEach(async () => {
  const { Instance } = await load()
  await Instance.disposeAll()
})

test("FileWatcherService publishes root create, update, and delete events", async () => {
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, "watch.txt")

  await start(tmp.path)

  await expect(
    nextUpdate(
      tmp.path,
      (evt) => evt.file === file && evt.event === "add",
      () => fs.writeFile(file, "a"),
    ),
  ).resolves.toEqual({
    file,
    event: "add",
  })

  await expect(
    nextUpdate(
      tmp.path,
      (evt) => evt.file === file && evt.event === "change",
      () => fs.writeFile(file, "b"),
    ),
  ).resolves.toEqual({
    file,
    event: "change",
  })

  await expect(
    nextUpdate(
      tmp.path,
      (evt) => evt.file === file && evt.event === "unlink",
      () => fs.unlink(file),
    ),
  ).resolves.toEqual({
    file,
    event: "unlink",
  })
})

test("FileWatcherService watches non-git roots", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "plain.txt")

  await start(tmp.path)

  await expect(
    nextUpdate(
      tmp.path,
      (evt) => evt.file === file && evt.event === "add",
      () => fs.writeFile(file, "plain"),
    ),
  ).resolves.toEqual({
    file,
    event: "add",
  })
})

test("FileWatcherService cleanup stops publishing events", async () => {
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, "after-dispose.txt")
  const { FileWatcher, GlobalBus } = await load()
  let seen = false

  await start(tmp.path)
  await stop(tmp.path)

  const on = (evt: { directory?: string; payload: { type: string; properties: { file: string } } }) => {
    if (evt.directory !== tmp.path) return
    if (evt.payload.type !== FileWatcher.Event.Updated.type) return
    if (evt.payload.properties.file === file) seen = true
  }

  GlobalBus.on("event", on)

  try {
    await fs.writeFile(file, "gone")
    await Bun.sleep(500)
    expect(seen).toBe(false)
  } finally {
    GlobalBus.off("event", on)
  }
})

test("FileWatcherService ignores non-HEAD git metadata changes", async () => {
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, ".git", "index")
  const edit = path.join(tmp.path, "tracked.txt")
  const { FileWatcher, GlobalBus } = await load()
  let seen = false

  await start(tmp.path)

  const on = (evt: { directory?: string; payload: { type: string; properties: { file: string } } }) => {
    if (evt.directory !== tmp.path) return
    if (evt.payload.type !== FileWatcher.Event.Updated.type) return
    if (evt.payload.properties.file === file) seen = true
  }

  GlobalBus.on("event", on)

  try {
    await fs.writeFile(edit, "a")
    await $`git add .`.cwd(tmp.path).quiet().nothrow()
    await Bun.sleep(500)
    expect(seen).toBe(false)
  } finally {
    GlobalBus.off("event", on)
  }
})
