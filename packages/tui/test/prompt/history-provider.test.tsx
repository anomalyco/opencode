/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { TuiPathsProvider } from "../../src/context/runtime"
import { PromptHistoryProvider, usePromptHistory } from "../../src/prompt/history"
import { tmpdir } from "../fixture/fixture"

test("down rejects at the newest history item with an empty prompt", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    setup.history.append("session-a", { text: "previous", files: [], agents: [], pasted: [] })

    expect(setup.history.move("session-a", 1, "")).toBeUndefined()
    expect(setup.history.move("session-a", -1, "")?.text).toBe("previous")
    expect(setup.history.move("session-a", 1, "previous")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("keeps independent prompt history and cursors for each session", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    setup.history.append("session-a", { text: "a-one", files: [], agents: [], pasted: [] })
    setup.history.append("session-b", { text: "b-one", files: [], agents: [], pasted: [] })
    setup.history.append("session-a", { text: "a-two", files: [], agents: [], pasted: [] })

    expect(setup.history.move("session-a", -1, "")?.text).toBe("a-two")
    expect(setup.history.move("session-b", -1, "")?.text).toBe("b-one")
    expect(setup.history.move("session-a", -1, "a-two")?.text).toBe("a-one")
    expect(setup.history.move("session-b", 1, "b-one")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("keeps legacy unscoped history on the home composer", async () => {
  await using tmp = await tmpdir()
  const legacy = JSON.stringify({ text: "legacy", files: [], agents: [], pasted: [] }) + "\n"
  const setup = await renderHistory(tmp.path, legacy)
  try {
    expect((await waitForHistory(setup.history))?.text).toBe("legacy")

    expect(setup.history.move("session-a", -1, "")).toBeUndefined()
    expect(setup.history.move(undefined, 1, "legacy")?.text).toBe("")
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
    const item = history.move(undefined, -1, "")
    if (item) return item
    await Bun.sleep(1)
  }
}
