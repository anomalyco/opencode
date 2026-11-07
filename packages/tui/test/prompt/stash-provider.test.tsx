import { expect, test } from "bun:test"
import { createComponent, createRoot } from "solid-js"
import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import { TuiAppProvider, TuiPathsProvider } from "../../src/context/runtime"
import { StorageProvider, useStorage } from "../../src/context/storage"
import { emptyPrompt } from "../../src/prompt/history"
import { PromptStashProvider, usePromptStash } from "../../src/prompt/stash"
import { tmpdir } from "../fixture/fixture"

const prompt = (text: string) => ({ prompt: { ...emptyPrompt(), text } })

test("concurrent pushes survive initialization and sync across running TUIs", async () => {
  await using tmp = await tmpdir()
  await using a = mount(tmp.path, "dev")
  await using b = mount(tmp.path, "beta")
  await Promise.all([a.stash.push(prompt("first")), b.stash.push(prompt("second"))])
  await until(() => a.stash.list().length === 2 && b.stash.list().length === 2)
  expect(
    a.stash
      .list()
      .map((entry) => entry.prompt.text)
      .sort(),
  ).toEqual(["first", "second"])
  await a.stash.push(prompt("later"))
  await until(() => b.stash.list().at(-1)?.prompt.text === "later")
  expect((await b.stash.pop())?.prompt.text).toBe("later")
  await until(() => a.stash.list().length === 2)
})

test("a stale selected ID cannot delete the neighboring prompt", async () => {
  await using tmp = await tmpdir()
  await using a = mount(tmp.path, "dev")
  await using b = mount(tmp.path, "beta")
  await a.stash.push(prompt("first"))
  await a.stash.push(prompt("second"))
  await until(() => b.stash.list().length === 2)
  const id = b.stash.list()[0].id
  expect((await a.stash.remove(id))?.prompt.text).toBe("first")
  expect(await b.stash.remove(id)).toBeUndefined()
  expect((await b.stash.pop())?.prompt.text).toBe("second")
})

test("legacy prompts import once, pop once, and stay consumed after restarting", async () => {
  await using tmp = await tmpdir()
  await Bun.write(
    path.join(tmp.path, "prompt-stash.jsonl"),
    JSON.stringify({ ...prompt("legacy"), timestamp: 1 }) + "\n",
  )
  {
    await using a = mount(tmp.path, "dev")
    await using b = mount(tmp.path, "beta")
    await until(() => a.stash.list().length === 1 && b.stash.list().length === 1)
    const entries = await Promise.all([a.stash.pop(), b.stash.pop()])
    expect(entries.filter(Boolean).map((entry) => entry?.prompt.text)).toEqual(["legacy"])
  }
  await using restarted = mount(tmp.path, "dev")
  expect(await restarted.stash.pop()).toBeUndefined()
})

test("a failed legacy import retries on the next mutation", async () => {
  await using tmp = await tmpdir()
  const legacy = path.join(tmp.path, "prompt-stash.jsonl")
  await mkdir(legacy)
  await using a = mount(tmp.path, "dev")
  await expect(a.stash.pop()).rejects.toThrow()

  await rm(legacy, { recursive: true })
  await Bun.write(legacy, JSON.stringify({ ...prompt("legacy"), timestamp: 1 }) + "\n")
  await a.stash.push(prompt("new"))
  expect(a.stash.list().map((entry) => entry.prompt.text)).toEqual(["legacy", "new"])
})

test("a corrupt shared store does not reimport consumed legacy prompts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(
    path.join(tmp.path, "prompt-stash.jsonl"),
    JSON.stringify({ ...prompt("consumed"), timestamp: 1 }) + "\n",
  )
  await mkdir(path.join(tmp.path, "tui"), { recursive: true })
  await Bun.write(path.join(tmp.path, "tui", "prompt-stash.json"), "not json")
  await using a = mount(tmp.path, "dev")
  expect(await a.stash.pop()).toBeUndefined()
})

test("stored entries with an incompatible shape are filtered before use", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "tui"), { recursive: true })
  const file = path.join(tmp.path, "tui", "prompt-stash.json")
  await Bun.write(
    file,
    JSON.stringify({
      migrated: true,
      entries: [
        { ...prompt("kept"), id: "valid", timestamp: 1 },
        { id: "bad-prompt", timestamp: 2, prompt: { text: 42 } },
        { id: "no-prompt", timestamp: 3 },
        "garbage",
      ],
    }),
  )
  await using a = mount(tmp.path, "dev")
  expect(a.stash.list().map((entry) => entry.prompt.text)).toEqual(["kept"])
  await a.stash.push(prompt("new"))
  const saved = await Bun.file(file).json()
  expect(saved.entries.map((entry: { prompt: { text: string } }) => entry.prompt.text)).toEqual(["kept", "new"])
})

test("a mid-session rewrite with an incompatible shape never reaches the list", async () => {
  await using tmp = await tmpdir()
  await using a = mount(tmp.path, "dev")
  await a.stash.push(prompt("kept"))
  const file = path.join(tmp.path, "tui", "prompt-stash.json")
  await Bun.write(
    file,
    JSON.stringify({
      migrated: true,
      entries: [{ id: "bad-prompt", timestamp: 2, prompt: { text: 42 } }],
    }),
  )
  await until(() => a.stash.list().length === 0)
  expect(await a.stash.pop()).toBeUndefined()
  await a.stash.push(prompt("new"))
  const saved = await Bun.file(file).json()
  expect(saved.entries.map((entry: { prompt: { text: string } }) => entry.prompt.text)).toEqual(["new"])
})

function mount(root: string, channel: string) {
  return createRoot((dispose) => {
    let stash!: ReturnType<typeof usePromptStash>
    let storage!: ReturnType<typeof useStorage>
    function Consumer() {
      stash = usePromptStash()
      storage = useStorage()
      return null
    }
    createComponent(TuiAppProvider, {
      value: { name: "test", version: "0.0.0", channel },
      get children() {
        return (
          <TuiPathsProvider value={{ cwd: path.join(root, channel), home: root, state: root, worktree: root }}>
            <StorageProvider>
              <PromptStashProvider>
                <Consumer />
              </PromptStashProvider>
            </StorageProvider>
          </TuiPathsProvider>
        )
      },
    })
    return {
      stash,
      async [Symbol.asyncDispose]() {
        await storage.flush().finally(dispose)
      },
    }
  })
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  expect(predicate()).toBe(true)
}
