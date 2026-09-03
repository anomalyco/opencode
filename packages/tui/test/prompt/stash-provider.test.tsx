import { expect, test } from "bun:test"
import { createComponent, createRoot } from "solid-js"
import path from "node:path"
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
  for (const _ of Array.from({ length: 100 })) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  expect(predicate()).toBe(true)
}
