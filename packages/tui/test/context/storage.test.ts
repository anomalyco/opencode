import { afterEach, expect, spyOn, test } from "bun:test"
import fs from "node:fs"
import { mkdtempSync, rmSync } from "fs"
import os from "node:os"
import path from "path"
import { createStorage } from "../../src/context/storage"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  spyOn(fs, "watch").mockRestore()
})

test("createStorage degrades gracefully when fs.watch throws (e.g. ENOSPC)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "storage-test-"))
  // fs.watch throws synchronously when inotify_add_watch fails (e.g. the watch
  // limit is exhausted). Simulate that scoped to this test only.
  spyOn(fs, "watch").mockImplementation(() => {
    throw Object.assign(new Error("ENOSPC: no space left on device, watch '/some/dir'"), { code: "ENOSPC" })
  })

  try {
    let result: ReturnType<typeof createStorage> | undefined
    expect(() => {
      result = createStorage(dir, "next")
    }).not.toThrow()

    // storage should still be usable even though the live-reload watcher failed to attach
    const [store, update] = result!.storage.store("kv", { initial: { count: 0 } })
    expect(store.count).toBe(0)
    await update((draft) => {
      draft.count = 1
    })
    expect(store.count).toBe(1)
    expect(() => result!.close()).not.toThrow()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("latest preserves prod tabs and plugin state without changing prod or overwriting later updates", async () => {
  await using temporary = await tmpdir()
  const tabs = { active: "session-before-upgrade", sessions: ["session-before-upgrade"] }
  const source = path.join(temporary.path, "prod", "tui", "session-tabs.json")
  await Bun.write(source, JSON.stringify(tabs))
  await Bun.write(path.join(temporary.path, "prod", "tui", "plugin.custom.json"), JSON.stringify({ enabled: true }))
  const latest = createStorage(temporary.path, "latest")
  try {
    const [store, update] = latest.storage.store("session-tabs", { initial: { active: "", sessions: [] as string[] } })
    expect(store).toEqual(tabs)
    expect(latest.storage.store("plugin.custom", { initial: { enabled: false } })[0].enabled).toBe(true)
    await update((draft) => {
      draft.active = "session-after-upgrade"
      draft.sessions.push("session-after-upgrade")
    })
    expect(await Bun.file(source).json()).toEqual(tabs)
  } finally {
    latest.close()
  }
  await Bun.write(source, JSON.stringify({ active: "changed-in-prod", sessions: [] }))
  const reopened = createStorage(temporary.path, "latest")
  try {
    expect(reopened.storage.store("session-tabs", { initial: { active: "", sessions: [] as string[] } })[0]).toEqual({
      active: "session-after-upgrade",
      sessions: ["session-before-upgrade", "session-after-upgrade"],
    })
  } finally {
    reopened.close()
  }
})

test.each([
  { name: "valid", content: '{"active":"latest"}', expected: "latest" },
  { name: "malformed", content: "{", expected: "initial" },
])("existing $name latest state takes precedence over prod", async (sample) => {
  await using temporary = await tmpdir()
  await Bun.write(path.join(temporary.path, "prod", "tui", "tabs.json"), '{"active":"prod"}')
  const destination = path.join(temporary.path, "latest", "tui", "tabs.json")
  await Bun.write(destination, sample.content)
  const latest = createStorage(temporary.path, "latest")
  try {
    expect(latest.storage.store("tabs", { initial: { active: "initial" } })[0].active).toBe(sample.expected)
    expect(await Bun.file(destination).text()).toBe(sample.content)
  } finally {
    latest.close()
  }
})

test.each(["dev", "next"])("%s storage remains isolated from prod", async (channel) => {
  await using temporary = await tmpdir()
  await Bun.write(path.join(temporary.path, "prod", "tui", "tabs.json"), '{"active":"prod"}')
  const result = createStorage(temporary.path, channel)
  try {
    expect(result.storage.store("tabs", { initial: { active: "initial" } })[0].active).toBe("initial")
  } finally {
    result.close()
  }
})

test("latest starts fresh when prod storage is absent", async () => {
  await using temporary = await tmpdir()
  const result = createStorage(temporary.path, "latest")
  try {
    const [store, update] = result.storage.store("tabs", { initial: { active: "initial" } })
    expect(store.active).toBe("initial")
    await update((draft) => {
      draft.active = "created-in-latest"
    })
    expect(store.active).toBe("created-in-latest")
  } finally {
    result.close()
  }
})

test("latest propagates legacy storage errors other than absence", async () => {
  await using temporary = await tmpdir()
  await Bun.write(path.join(temporary.path, "prod", "tui"), "not a directory")
  expect(() => createStorage(temporary.path, "latest")).toThrow("ENOTDIR")
})
