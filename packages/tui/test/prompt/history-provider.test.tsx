/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { TuiPathsProvider } from "../../src/context/runtime"
import {
  emptyPrompt,
  MAX_HISTORY_ENTRIES,
  PromptHistoryProvider,
  usePromptHistory,
  type PromptHistoryScope,
} from "../../src/prompt/history"
import { tmpdir } from "../fixture/fixture"

const prompt = (text: string) => ({ text, files: [], agents: [], pasted: [] })

test("down rejects at the newest history item with an empty prompt", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    const history = setup.history("session-a")
    history.append(prompt("previous"))

    expect(history.move(1, "")).toBeUndefined()
    expect(history.move(-1, "")?.text).toBe("previous")
    expect(history.move(1, "previous")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("global scope shares prompt history across sessions and the home composer", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    const a = setup.history("session-a")
    const b = setup.history("session-b")
    a.append(prompt("a-one"))
    b.append(prompt("b-one"))
    a.append(prompt("a-two"))

    expect(a.move(-1, "")?.text).toBe("a-two")
    expect(a.move(-1, "a-two")?.text).toBe("b-one")
    expect(a.move(-1, "b-one")?.text).toBe("a-one")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("session scope keeps independent history and cursors per session", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  setup.setScope("session")
  try {
    const a = setup.history("session-a")
    const b = setup.history("session-b")
    a.append(prompt("a-one"))
    b.append(prompt("b-one"))
    a.append(prompt("a-two"))

    expect(a.move(-1, "")?.text).toBe("a-two")
    expect(b.move(-1, "")?.text).toBe("b-one")
    expect(a.move(-1, "a-two")?.text).toBe("a-one")
    expect(b.move(1, "b-one")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a submit resets only the submitting session cursor", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  setup.setScope("session")
  try {
    const home = setup.history()
    const a = setup.history("session-a")
    const b = setup.history("session-b")
    home.append(prompt("home-one"))
    home.append(prompt("home-two"))
    a.append(prompt("a-one"))
    a.append(prompt("a-two"))

    expect(home.move(-1, "")?.text).toBe("home-two")
    expect(a.move(-1, "")?.text).toBe("a-two")
    b.append(prompt("b-one"))
    expect(home.move(-1, "home-two")?.text).toBe("home-one")
    expect(a.move(-1, "a-two")?.text).toBe("a-one")

    home.append(prompt("home-three"))
    expect(home.move(-1, "")?.text).toBe("home-three")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("session scope keeps each session's own retention and persists flat entries", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  setup.setScope("session")
  try {
    const b = setup.history("session-b")
    for (let index = 0; index <= MAX_HISTORY_ENTRIES; index += 1) {
      b.append(prompt(`b-${index}`))
    }
    setup.history("session-a").append(prompt("a-new"))

    expect(setup.history("session-a").move(-1, "")?.text).toBe("a-new")
    expect(b.move(-1, "")?.text).toBe(`b-${MAX_HISTORY_ENTRIES}`)

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

test("a busy session does not evict another session's history", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  setup.setScope("session")
  try {
    const a = setup.history("session-a")
    const b = setup.history("session-b")
    b.append(prompt("b-one"))
    for (let index = 0; index <= MAX_HISTORY_ENTRIES; index += 1) {
      a.append(prompt(`a-${index}`))
    }

    expect(b.move(-1, "")?.text).toBe("b-one")
    expect(a.move(-1, "")?.text).toBe(`a-${MAX_HISTORY_ENTRIES}`)
    expect(a.move(-1, `a-${MAX_HISTORY_ENTRIES}`)?.text).toBe(`a-${MAX_HISTORY_ENTRIES - 1}`)
  } finally {
    setup.app.renderer.destroy()
  }
})

test("session scope trims a single session without looping", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  setup.setScope("session")
  try {
    const a = setup.history("session-a")
    for (let index = 0; index <= MAX_HISTORY_ENTRIES; index += 1) {
      a.append(prompt(`a-${index}`))
    }

    expect(a.move(-1, "")?.text).toBe(`a-${MAX_HISTORY_ENTRIES}`)
    expect(a.move(-1, `a-${MAX_HISTORY_ENTRIES}`)?.text).toBe(`a-${MAX_HISTORY_ENTRIES - 1}`)
  } finally {
    setup.app.renderer.destroy()
  }
})

test("interleaved sessions keep independent cursor positions", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  setup.setScope("session")
  try {
    const a = setup.history("session-a")
    const b = setup.history("session-b")
    a.append(prompt("a-one"))
    a.append(prompt("a-two"))
    b.append(prompt("b-one"))
    b.append(prompt("b-two"))

    expect(a.move(-1, "")?.text).toBe("a-two")
    expect(b.move(-1, "")?.text).toBe("b-two")
    expect(a.move(-1, "a-two")?.text).toBe("a-one")
    expect(b.move(-1, "b-two")?.text).toBe("b-one")
    expect(a.move(1, "a-one")?.text).toBe("a-two")
    expect(b.move(1, "b-one")?.text).toBe("b-two")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("entries appended under one scope are recalled under the other", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    const a = setup.history("session-a")
    a.append(prompt("a-one"))

    setup.setScope("session")
    expect(a.move(-1, "")?.text).toBe("a-one")
    expect(setup.history().move(-1, "")).toBeUndefined()
  } finally {
    setup.app.renderer.destroy()
  }
})

test("legacy unscoped entries belong to the home composer, not a named session", async () => {
  await using tmp = await tmpdir()
  const legacy = JSON.stringify(prompt("legacy")) + "\n"
  const setup = await renderHistory(tmp.path, legacy)
  try {
    const home = setup.history()
    const a = setup.history("session-a")
    expect((await waitForHistory(home))?.text).toBe("legacy")

    setup.setScope("session")
    expect(a.move(-1, "")).toBeUndefined()
    expect(home.move(-1, "")?.text).toBe("legacy")
    expect(home.has()).toBe(true)
    expect(a.has()).toBe(false)
    setup.setScope("global")
    expect(home.move(-1, "")?.text).toBe("legacy")
    expect(home.move(1, "legacy")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("switching scope resets the active cursor", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    const a = setup.history("session-a")
    a.append(prompt("a-one"))
    a.append(prompt("a-two"))
    expect(a.move(-1, "")?.text).toBe("a-two")
    expect(a.move(-1, "a-two")?.text).toBe("a-one")

    setup.setScope("session")
    expect(a.move(-1, "")?.text).toBe("a-two")
    setup.setScope("global")
    expect(a.move(-1, "")?.text).toBe("a-two")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("reset clears browsing position and live draft, and move returns a deep copy", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    const history = setup.history()
    history.append({
      text: "[Pasted ~3 lines] ",
      files: [],
      agents: [],
      pasted: [{ text: "a\nb\nc", source: { start: 0, end: 17, text: "[Pasted ~3 lines]" } }],
    })

    const recalled = history.move(-1, "unsent draft")
    expect(recalled?.text).toBe("[Pasted ~3 lines] ")
    recalled!.pasted[0]!.source.start = 99
    recalled!.pasted.push({ text: "extra", source: { start: 0, end: 5, text: "extra" } })

    history.reset()
    expect(history.move(1, "")).toBeUndefined()

    const again = history.move(-1, "fresh draft")
    expect(again?.pasted).toEqual([{ text: "a\nb\nc", source: { start: 0, end: 17, text: "[Pasted ~3 lines]" } }])
    expect(history.move(1, "[Pasted ~3 lines] ")?.text).toBe("fresh draft")
  } finally {
    setup.app.renderer.destroy()
  }
})

async function renderHistory(root: string, persisted?: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  if (persisted) await Bun.write(path.join(state, "prompt-history.jsonl"), persisted)
  let scope: PromptHistoryScope = "global"
  const histories = {} as Record<"home" | "session-a" | "session-b", ReturnType<typeof usePromptHistory>>

  function Consumer() {
    histories.home = usePromptHistory(emptyPrompt, { sessionID: () => undefined, scope: () => scope })
    histories["session-a"] = usePromptHistory(emptyPrompt, { sessionID: () => "session-a", scope: () => scope })
    histories["session-b"] = usePromptHistory(emptyPrompt, { sessionID: () => "session-b", scope: () => scope })
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
  return {
    app,
    setScope(next: PromptHistoryScope) {
      scope = next
    },
    history(sessionID?: string) {
      const key = (sessionID ?? "home") as "home" | "session-a" | "session-b"
      return histories[key]
    },
  }
}

async function waitForHistory(history: ReturnType<typeof usePromptHistory>) {
  for (const _ of Array.from({ length: 100 })) {
    const item = history.move(-1, "")
    if (item) return item
    await Bun.sleep(1)
  }
}
