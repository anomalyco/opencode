/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { TuiAppProvider, TuiPathsProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
import { MAX_STASH_ENTRIES, PromptStashProvider, usePromptStash } from "../../src/prompt/stash"
import { tmpdir } from "../fixture/fixture"

const prompt = (text: string) => ({ text, files: [], agents: [], skills: [], pasted: [] })

test("a running TUI observes another TUI's stash without restarting", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(
    path.join(state, "prompt-stash.jsonl"),
    JSON.stringify({ prompt: prompt("old"), timestamp: 1 }) + "\n",
  )
  const setup = await renderStashes(tmp.path, state)
  try {
    await until(() => setup.stashes.every((stash) => stash.list().length === 1))
    await setup.stashes[0].push({ prompt: prompt("from terminal A") })
    await until(() => setup.stashes[1].list().length === 2)
    expect(setup.stashes[1].list().at(-1)?.prompt.text).toBe("from terminal A")
    expect((await setup.stashes[1].pop())?.prompt.text).toBe("from terminal A")
    await until(() => setup.stashes[0].list().length === 1)
  } finally {
    setup.app.renderer.destroy()
  }
})

test("concurrent pushes before initialization preserve both prompts", async () => {
  await using tmp = await tmpdir()
  const setup = await renderStashes(tmp.path, path.join(tmp.path, "state"))
  try {
    await Promise.all(setup.stashes.map((stash, index) => stash.push({ prompt: prompt(String(index)) })))
    await until(() => setup.stashes.every((stash) => stash.list().length === 2))
    expect(
      setup.stashes[0]
        .list()
        .map((entry) => entry.prompt.text)
        .sort(),
    ).toEqual(["0", "1"])
    expect(new Set(setup.stashes[0].list().map((entry) => entry.id)).size).toBe(2)
  } finally {
    setup.app.renderer.destroy()
  }
})

test("stale selected IDs neither consume a prompt twice nor remove a neighboring entry", async () => {
  await using tmp = await tmpdir()
  const setup = await renderStashes(tmp.path, path.join(tmp.path, "state"))
  try {
    await setup.stashes[0].push({ prompt: prompt("first") })
    await setup.stashes[0].push({ prompt: prompt("second") })
    await until(() => setup.stashes[1].list().length === 2)
    const id = setup.stashes[1].list()[0].id
    expect((await setup.stashes[0].remove(id))?.prompt.text).toBe("first")
    expect(await setup.stashes[1].remove(id)).toBeUndefined()
    expect((await setup.stashes[1].pop())?.prompt.text).toBe("second")
    await until(() => setup.stashes.every((stash) => stash.list().length === 0))
  } finally {
    setup.app.renderer.destroy()
  }
})

test("an emptied stash does not reimport legacy JSONL after restarting", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  const legacy = path.join(state, "prompt-stash.jsonl")
  await Bun.write(legacy, JSON.stringify({ prompt: prompt("legacy"), timestamp: 1 }) + "\n")
  const first = await renderStashes(tmp.path, state)
  try {
    await until(() => first.stashes.every((stash) => stash.list().length === 1))
    expect((await first.stashes[0].pop())?.prompt.text).toBe("legacy")
    expect(await first.stashes[1].pop()).toBeUndefined()
  } finally {
    first.app.renderer.destroy()
  }
  const next = await renderStashes(tmp.path, state)
  try {
    await next.stashes[0].push({ prompt: prompt("new") })
    await until(() => next.stashes.every((stash) => stash.list().length === 1))
    expect((await next.stashes[1].pop())?.prompt.text).toBe("new")
    expect(await next.stashes[0].pop()).toBeUndefined()
    expect(await Bun.file(legacy).text()).toContain("legacy")
  } finally {
    next.app.renderer.destroy()
  }
})

test("retention is enforced on shared state and push snapshots the complete draft", async () => {
  await using tmp = await tmpdir()
  const setup = await renderStashes(tmp.path, path.join(tmp.path, "state"))
  try {
    for (const index of Array.from({ length: MAX_STASH_ENTRIES + 2 }, (_, index) => index)) {
      await setup.stashes[index % 2].push({ prompt: prompt(String(index)) })
    }
    await until(() =>
      setup.stashes.every((stash) => stash.list().length === MAX_STASH_ENTRIES && stash.list()[0].prompt.text === "2"),
    )
    expect(setup.stashes[0].list()[0].prompt.text).toBe("2")
    const draft = {
      ...prompt("[pasted]"),
      mode: "shell" as const,
      pasted: [{ text: "full pasted text", source: { start: 0, end: 8, text: "[pasted]" } }],
    }
    const saving = setup.stashes[0].push({ prompt: draft })
    expect(setup.stashes[0].pending()).toBe(true)
    draft.text = "edited while saving"
    await saving
    expect(setup.stashes[0].pending()).toBe(false)
    expect((await setup.stashes[1].pop())?.prompt).toEqual({ ...draft, text: "[pasted]" })
  } finally {
    setup.app.renderer.destroy()
  }
})

test("two TUIs cannot pop the same stashed prompt", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(
    path.join(state, "prompt-stash.jsonl"),
    JSON.stringify({ prompt: prompt("only"), timestamp: 1 }) + "\n",
  )
  const setup = await renderStashes(tmp.path, state)
  try {
    await until(() => setup.stashes.every((stash) => stash.list().length === 1))
    const pops = setup.stashes.map((stash) => stash.pop())
    expect(setup.stashes.every((stash) => stash.pending())).toBe(true)
    const entries = await Promise.all(pops)
    expect(setup.stashes.every((stash) => !stash.pending())).toBe(true)
    expect(entries.filter(Boolean)).toHaveLength(1)
    await until(() => setup.stashes.every((stash) => stash.list().length === 0))
  } finally {
    setup.app.renderer.destroy()
  }
})

async function renderStashes(root: string, state: string) {
  const stashes: ReturnType<typeof usePromptStash>[] = []
  function Consumer() {
    stashes.push(usePromptStash())
    return <box />
  }
  const app = await testRender(() => (
    <>
      {["dev", "beta"].map((channel) => (
        <TuiAppProvider value={{ name: "test", version: "0.0.0", channel }}>
          <TuiPathsProvider value={{ cwd: path.join(root, channel), home: root, state, worktree: root }}>
            <StorageProvider>
              <PromptStashProvider>
                <Consumer />
              </PromptStashProvider>
            </StorageProvider>
          </TuiPathsProvider>
        </TuiAppProvider>
      ))}
    </>
  ))
  await app.renderOnce()
  return { app, stashes }
}

async function until(predicate: () => boolean) {
  for (const _ of Array.from({ length: 100 })) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  expect(predicate()).toBe(true)
}
