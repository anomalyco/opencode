/** @jsxImportSource @opentui/solid */
import { Flock } from "@opencode-ai/util/flock"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import path from "node:path"
import { DialogStash } from "../../src/component/dialog-stash"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider, useStorage } from "../../src/context/storage"
import { ThemeProvider } from "../../src/context/theme"
import { PromptStashProvider, usePromptStash, type StashEntry } from "../../src/prompt/stash"
import { emptyPrompt } from "../../src/prompt/history"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { DialogSelect } from "../../src/ui/dialog-select"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const prompt = (text: string) => ({ ...emptyPrompt(), text })

test("a dismissed stash restores its consumed entry without closing the replacement dialog", async () => {
  await using tmp = await tmpdir()
  using fixture = await renderStash(tmp.path)
  await fixture.stashes[0].push({ prompt: prompt("saved prompt") })
  fixture.open()
  await fixture.app.waitForFrame((frame) => frame.includes("saved prompt"))

  const lock = await Flock.acquire(path.join(tmp.path, "tui", "prompt-stash.json"), {
    dir: path.join(tmp.path, "locks"),
  })
  try {
    fixture.app.mockInput.pressEnter()
    fixture.app.mockInput.pressEscape()
    expect(fixture.dialogs[0].stack).toHaveLength(0)
    fixture.dialogs[0].replace(() => (
      <DialogSelect title="Replacement dialog" options={[{ title: "Other choice", value: "other" }]} />
    ))
    await fixture.app.waitForFrame((frame) => frame.includes("Replacement dialog"))
    expect(fixture.restored).toHaveLength(0)
  } finally {
    await lock.release()
  }

  await fixture.app.waitFor(() => fixture.restored.length === 1)
  expect(fixture.restored[0].prompt.text).toBe("saved prompt")
  expect(fixture.stashes[0].list()).toHaveLength(0)
  expect(fixture.dialogs[0].stack).toHaveLength(1)
  await fixture.app.waitForFrame((frame) => frame.includes("Replacement dialog"))
})

test("a live stash update preserves the selected prompt by ID", async () => {
  await using tmp = await tmpdir()
  using fixture = await renderStash(tmp.path)
  await fixture.stashes[0].push({ prompt: prompt("first") })
  await fixture.stashes[0].push({ prompt: prompt("second") })
  fixture.open()
  await fixture.app.waitForFrame((frame) => frame.includes("first") && frame.includes("second"))
  fixture.app.mockInput.pressArrow("down")

  await fixture.stashes[1].push({ prompt: prompt("third") })
  await fixture.app.waitForFrame((frame) => frame.includes("third"))
  fixture.app.mockInput.pressEnter()

  await fixture.app.waitFor(() => fixture.restored.length === 1)
  expect(fixture.restored[0].prompt.text).toBe("first")
  expect(fixture.stashes[0].list().map((entry) => entry.prompt.text)).toEqual(["second", "third"])
  expect(fixture.dialogs[0].stack).toHaveLength(0)
})

async function renderStash(root: string) {
  const stashes: ReturnType<typeof usePromptStash>[] = []
  const dialogs: ReturnType<typeof useDialog>[] = []
  const storages: ReturnType<typeof useStorage>[] = []
  const restored: StashEntry[] = []
  function Consumer() {
    stashes.push(usePromptStash())
    dialogs.push(useDialog())
    storages.push(useStorage())
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state: root, worktree: root }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                {["dev", "beta"].map((channel) => (
                  <TuiAppProvider value={{ name: "test", version: "0.0.0", channel }}>
                    <StorageProvider>
                      <PromptStashProvider>
                        <DialogProvider>
                          <Consumer />
                        </DialogProvider>
                      </PromptStashProvider>
                    </StorageProvider>
                  </TuiAppProvider>
                ))}
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitFor(() => stashes.length === 2)
  await Promise.all(storages.map((storage) => storage.flush()))
  return {
    app,
    stashes,
    dialogs,
    restored,
    open: () => dialogs[0].replace(() => <DialogStash onSelect={(entry) => restored.push(entry)} />),
    [Symbol.dispose]: () => app.renderer.destroy(),
  }
}
