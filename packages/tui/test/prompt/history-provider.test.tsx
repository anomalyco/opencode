/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { TuiPathsProvider } from "../../src/context/runtime"
import { MAX_HISTORY_ENTRIES, PromptHistoryProvider, usePromptHistory } from "../../src/prompt/history"
import { tmpdir } from "../fixture/fixture"

const prompt = (text: string) => ({ text, files: [], agents: [], pasted: [] })

test("down rejects at the newest history item with an empty prompt", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    await Bun.sleep(20)
    setup.history.append("session-a", prompt("previous"), "global")

    expect(setup.history.move("session-a", 1, "", "global")).toBeUndefined()
    expect(setup.history.move("session-a", -1, "", "global")?.text).toBe("previous")
    expect(setup.history.move("session-a", 1, "previous", "global")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("global scope shares prompt history across sessions and the home composer", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    setup.history.append("session-a", prompt("a-one"), "global")
    setup.history.append("session-b", prompt("b-one"), "global")
    setup.history.append("session-a", prompt("a-two"), "global")

    expect(setup.history.move("session-a", -1, "", "global")?.text).toBe("a-two")
    expect(setup.history.move("session-a", -1, "a-two", "global")?.text).toBe("b-one")
    expect(setup.history.move("session-a", -1, "b-one", "global")?.text).toBe("a-one")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("session scope keeps independent history and cursors per session", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    setup.history.append("session-a", prompt("a-one"), "session")
    setup.history.append("session-b", prompt("b-one"), "session")
    setup.history.append("session-a", prompt("a-two"), "session")

    expect(setup.history.move("session-a", -1, "", "session")?.text).toBe("a-two")
    expect(setup.history.move("session-b", -1, "", "session")?.text).toBe("b-one")
    expect(setup.history.move("session-a", -1, "a-two", "session")?.text).toBe("a-one")
    expect(setup.history.move("session-b", 1, "b-one", "session")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a submit resets every cursor, including the home composer", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    await Bun.sleep(20)
    setup.history.append(undefined, prompt("home-one"), "session")
    setup.history.append(undefined, prompt("home-two"), "session")
    setup.history.append("session-a", prompt("a-one"), "session")

    expect(setup.history.move(undefined, -1, "", "session")?.text).toBe("home-two")
    setup.history.append("session-b", prompt("b-one"), "session")
    expect(setup.history.move(undefined, -1, "", "session")?.text).toBe("home-two")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("session scope trims other sessions before the active one and persists flat entries", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    await Bun.sleep(20)
    for (let index = 0; index <= MAX_HISTORY_ENTRIES; index += 1) {
      setup.history.append("session-b", prompt(`b-${index}`), "session")
    }
    setup.history.append("session-a", prompt("a-new"), "session")

    expect(setup.history.move("session-a", -1, "", "session")?.text).toBe("a-new")
    expect(setup.history.move("session-b", -1, "", "session")?.text).toBe(`b-${MAX_HISTORY_ENTRIES}`)

    const historyFile = path.join(tmp.path, "state", "prompt-history.jsonl")
    for (let tries = 0; tries < 100 && !(await Bun.file(historyFile).exists()); tries += 1) await Bun.sleep(1)
    const text = await Bun.file(historyFile).text()
    const first = JSON.parse(text.split("\n")[0]!)
    expect(typeof first.text).toBe("string")
    expect(typeof first.sessionID).toBe("string")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("entries appended under one scope are recalled under the other", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    setup.history.append("session-a", prompt("a-one"), "global")

    expect(setup.history.move("session-a", -1, "", "session")?.text).toBe("a-one")
    expect(setup.history.move(undefined, -1, "", "session")).toBeUndefined()
  } finally {
    setup.app.renderer.destroy()
  }
})

test("session scope ignores legacy unscoped entries that global scope recalls", async () => {
  await using tmp = await tmpdir()
  const legacy = JSON.stringify(prompt("legacy")) + "\n"
  const setup = await renderHistory(tmp.path, legacy)
  try {
    expect((await waitForHistory(setup.history))?.text).toBe("legacy")

    expect(setup.history.move("session-a", -1, "", "session")).toBeUndefined()
    expect(setup.history.move("session-a", 1, "legacy", "global")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

async function renderHistory(root: string, persisted?: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  if (persisted) await Bun.write(path.join(state, "prompt-history.jsonl"), persisted)
  let history: ReturnType<typeof usePromptHistory>

  function Consumer() {
    history = usePromptHistory()
    return <box />
  }

  const app = await testRender(() => (
    <TuiPathsProvider value={{ cwd: root, home: root, state, worktree: root }}>
      <PromptHistoryProvider>
        <Consumer />
      </PromptHistoryProvider>
    </TuiPathsProvider>
  ))
  await app.renderOnce()
  return { app, history: history! }
}

async function waitForHistory(history: ReturnType<typeof usePromptHistory>) {
  for (const _ of Array.from({ length: 100 })) {
    const item = history.move(undefined, -1, "", "global")
    if (item) return item
    await Bun.sleep(1)
  }
}
