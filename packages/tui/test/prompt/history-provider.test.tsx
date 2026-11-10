/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir, utimes } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { readKeptAttachments } from "../../src/component/prompt/local-attachment"
import { ClientProvider } from "../../src/context/client"
import { TuiPathsProvider } from "../../src/context/runtime"
import {
  PromptHistoryProvider,
  promptMediaDirectory,
  usePromptHistory,
  type PromptInfo,
} from "../../src/prompt/history"
import { PromptStashProvider, usePromptStash } from "../../src/prompt/stash"
import { tmpdir } from "../fixture/fixture"
import { createApi, createFetch } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"

test("down rejects at the newest history item with an empty prompt", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    setup.history.append({ text: "previous", files: [], agents: [], pasted: [] })

    expect(setup.history.move(1, "")).toBeUndefined()
    expect(setup.history.move(-1, "")?.text).toBe("previous")
    expect(setup.history.move(1, "previous")?.text).toBe("")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("shares prompt history across sessions and the home composer", async () => {
  await using tmp = await tmpdir()
  const setup = await renderHistory(tmp.path)
  try {
    setup.history.append({ text: "a-one", files: [], agents: [], pasted: [] })
    setup.history.append({ text: "b-one", files: [], agents: [], pasted: [] })
    setup.history.append({ text: "a-two", files: [], agents: [], pasted: [] })

    expect(setup.history.move(-1, "")?.text).toBe("a-two")
    expect(setup.history.move(-1, "a-two")?.text).toBe("b-one")
    expect(setup.history.move(-1, "b-one")?.text).toBe("a-one")
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

    expect(setup.history.move(1, "legacy")?.text).toBe("")
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
    const item = history.move(-1, "")
    if (item) return item
    await Bun.sleep(1)
  }
}

// Each provider's entries, and a way to add one that returns once it is written.
const providers = {
  history: {
    file: "prompt-history.jsonl",
    line: (prompt: PromptInfo) => JSON.stringify(prompt),
    Provider: PromptHistoryProvider,
    use: () => {
      const history = usePromptHistory()
      return { loaded: history.loaded, add: history.append }
    },
  },
  stash: {
    file: "prompt-stash.jsonl",
    line: (prompt: PromptInfo) => JSON.stringify({ prompt, timestamp: 1 }),
    Provider: PromptStashProvider,
    use: () => {
      const stash = usePromptStash()
      return { loaded: stash.loaded, add: (prompt: PromptInfo) => stash.push({ prompt }) }
    },
  },
}

test.each(["history", "stash"] as const)(
  "the %s prunes kept videos no entry names when it loads and when it drops its oldest entry",
  async (kind) => {
    await using tmp = await tmpdir()
    const state = path.join(tmp.path, "state")
    const provider = providers[kind]
    const video = (name: string) => path.join(promptMediaDirectory(state), name.repeat(32) + ".mp4")
    const [unnamed, oldest] = [video("0a"), video("0b")]
    const prompt = (text: string, file?: string): PromptInfo => ({
      text,
      files: file ? [{ uri: pathToFileURL(file).href, path: file }] : [],
      agents: [],
      pasted: [],
    })
    const day = new Date(Date.now() - 25 * 60 * 60 * 1000)
    for (const file of [unnamed, oldest]) {
      await Bun.write(file, "")
      await utimes(file, day, day)
    }
    const lines = [prompt("oldest", oldest), ...Array.from({ length: 49 }, (_, index) => prompt(String(index)))]
    await Bun.write(path.join(state, provider.file), lines.map(provider.line).join("\n") + "\n")

    let entries: ReturnType<typeof provider.use> | undefined
    function Consumer() {
      entries = provider.use()
      return <box />
    }
    const app = await testRender(() => (
      <TuiPathsProvider value={{ cwd: tmp.path, home: tmp.path, state, worktree: tmp.path }}>
        <provider.Provider>
          <Consumer />
        </provider.Provider>
      </TuiPathsProvider>
    ))
    try {
      await entries!.loaded
      expect(await Bun.file(unnamed).exists()).toBe(false)
      expect(await Bun.file(oldest).exists()).toBe(true)

      await entries!.add(prompt("newest"))
      expect(await Bun.file(oldest).exists()).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  },
)

test.each(["history", "stash"] as const)(
  "the %s records the server a restored file came from across a restart, and only for its own server",
  async (kind) => {
    await using tmp = await tmpdir()
    const state = path.join(tmp.path, "state")
    await mkdir(state, { recursive: true })
    const provider = providers[kind]
    const restored = { uri: "file:///home/devbox/shot.png", mention: { start: 0, end: 9, text: "[Image 1]" } }
    const mount = async () => {
      let entries: ReturnType<typeof provider.use> | undefined
      function Consumer() {
        entries = provider.use()
        return <box />
      }
      const app = await testRender(() => (
        <TestTuiContexts paths={{ cwd: tmp.path, home: tmp.path, state, worktree: tmp.path }}>
          <ClientProvider api={createApi(createFetch().fetch)} url="https://devbox.example:4096/">
            <provider.Provider>
              <Consumer />
            </provider.Provider>
          </ClientProvider>
        </TestTuiContexts>
      ))
      await entries!.loaded
      return { app, entries: entries! }
    }

    const first = await mount()
    try {
      await first.entries.add({ text: "[Image 1]", files: [restored], agents: [], pasted: [] })
    } finally {
      first.app.renderer.destroy()
    }
    // Loading rewrites the file, and the entry still names the server it was written against.
    const second = await mount()
    second.app.renderer.destroy()
    const [line] = (await Bun.file(path.join(state, provider.file)).text()).trim().split("\n")
    const files = (kind === "history" ? JSON.parse(line!) : JSON.parse(line!).prompt).files
    expect(files).toEqual([{ ...restored, server: "https://devbox.example:4096" }])

    expect(await readKeptAttachments(files, false, "https://devbox.example:4096")).toEqual({ files, unreadable: [] })
    expect((await readKeptAttachments(files, false, "https://other.example:4096")).unreadable).toEqual(["shot.png"])
  },
)
