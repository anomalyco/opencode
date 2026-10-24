import { afterEach, describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { createSettingsStore } from "../storage/store"
import { DefaultProject } from "./default-project"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const fixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-default-project-"))
  directories.push(directory)

  return directory
}

describe("onboarding default project", () => {
  test("restores its recorded path after a restart, without depending on the current locale", async () => {
    const directory = await fixture()
    const settings = path.join(directory, "opencode.settings")
    const project = path.join(directory, "Проект по умолчанию")
    const store = createSettingsStore(settings)
    await Effect.runPromise(DefaultProject.create(store, project).pipe(Effect.provide(NodeFileSystem.layer)))
    store.set("firstLaunchOnboardingComplete", true)
    await rm(project, { recursive: true })

    const restored = createSettingsStore(settings)
    await Effect.runPromise(DefaultProject.restore(restored).pipe(Effect.provide(NodeFileSystem.layer)))
    expect((await stat(project)).isDirectory()).toBe(true)
    expect(restored.get("firstLaunchOnboardingComplete")).toBe(true)
    const file = path.join(project, "keep.txt")
    await writeFile(file, "keep")
    await Effect.runPromise(DefaultProject.restore(restored).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await readFile(file, "utf8")).toBe("keep")
  })

  test("does not invent a default project for a profile that never created one", async () => {
    const directory = await fixture()
    const settings = path.join(directory, "opencode.settings")
    const store = createSettingsStore(settings)
    store.set("firstLaunchOnboardingComplete", true)
    await Effect.runPromise(DefaultProject.restore(store).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await readFile(settings, "utf8")).toBe(JSON.stringify({ firstLaunchOnboardingComplete: true }, null, "\t"))
  })

  test("keeps a conflicting file and does not record a failed creation", async () => {
    const directory = await fixture()
    const store = createSettingsStore(path.join(directory, "opencode.settings"))
    const project = path.join(directory, "Default Project")
    await writeFile(project, "keep")
    await expect(
      Effect.runPromise(DefaultProject.create(store, project).pipe(Effect.provide(NodeFileSystem.layer))),
    ).rejects.toThrow()
    expect(await readFile(project, "utf8")).toBe("keep")
    expect(store.get("defaultProjectDirectory")).toBeUndefined()
  })
})
