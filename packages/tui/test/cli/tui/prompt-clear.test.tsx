/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import type { TuiKeybind } from "../../../src/config/keybind"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountPrompt(input: {
  root: string
  keybinds?: Partial<TuiKeybind.Keybinds>
  sessionID?: string
}) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { ClipboardProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
    { ArgsProvider },
    { KVProvider },
    { ToastProvider },
    { RouteProvider },
    { TuiConfigProvider },
    { SDKProvider },
    { PermissionProvider },
    { ProjectProvider },
    { ExitProvider },
    { SyncProvider },
    { DataProvider },
    { ThemeProvider },
    { LocalProvider },
    { PromptStashProvider },
    { DialogProvider },
    { FrecencyProvider },
    { PromptHistoryProvider },
    { EditorContextProvider },
    { LocationProvider },
    { Prompt },
  ] = await Promise.all([
    import("../../../src/context/clipboard"),
    import("../../../src/keymap"),
    import("../../../src/context/args"),
    import("../../../src/context/kv"),
    import("../../../src/ui/toast"),
    import("../../../src/context/route"),
    import("../../../src/config"),
    import("../../../src/context/sdk"),
    import("../../../src/context/permission"),
    import("../../../src/context/project"),
    import("../../../src/context/exit"),
    import("../../../src/context/sync"),
    import("../../../src/context/data"),
    import("../../../src/context/theme"),
    import("../../../src/context/local"),
    import("../../../src/prompt/stash"),
    import("../../../src/ui/dialog"),
    import("../../../src/prompt/frecency"),
    import("../../../src/prompt/history"),
    import("../../../src/context/editor"),
    import("../../../src/context/location"),
    import("../../../src/component/prompt"),
  ])

  const calls = createFetch()
  const events = createEventSource()
  let promptRef: import("../../../src/component/prompt").PromptRef | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({
      keybinds: input.keybinds,
      leader_timeout: 1000,
    })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts paths={{ state }}>
        <ClipboardProvider>
          <OpencodeKeymapProvider keymap={keymap}>
            <ArgsProvider>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider>
                    <TuiConfigProvider config={resolvedConfig}>
                      <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                        <PermissionProvider>
                          <ProjectProvider>
                            <ExitProvider exit={() => {}}>
                              <SyncProvider>
                                <DataProvider>
                                  <ThemeProvider mode="dark">
                                    <LocalProvider>
                                      <PromptStashProvider>
                                        <DialogProvider>
                                          <FrecencyProvider>
                                            <PromptHistoryProvider>
                                              <EditorContextProvider>
                                                <LocationProvider>
                                                  <Prompt sessionID={input.sessionID} ref={(r) => (promptRef = r)} />
                                                </LocationProvider>
                                              </EditorContextProvider>
                                            </PromptHistoryProvider>
                                          </FrecencyProvider>
                                        </DialogProvider>
                                      </PromptStashProvider>
                                    </LocalProvider>
                                  </ThemeProvider>
                                </DataProvider>
                              </SyncProvider>
                            </ExitProvider>
                          </ProjectProvider>
                        </PermissionProvider>
                      </SDKProvider>
                    </TuiConfigProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ArgsProvider>
          </OpencodeKeymapProvider>
        </ClipboardProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable, 5000)
  const textarea = app.renderer.currentFocusedEditor as TextareaRenderable

  // The prompt module stashes non-empty input across unmounts; start each test empty.
  if (textarea.plainText !== "") promptRef?.reset()
  await wait(() => textarea.plainText === "")

  return {
    app,
    textarea,
    emit: events.emit,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

const DRAFT = "this is a draft message for testing"

test("double escape clears the prompt input and saves the draft to history", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt({ root: tmp.path })

  try {
    await prompt.app.mockInput.typeText(DRAFT)
    await wait(() => prompt.textarea.plainText === DRAFT)

    prompt.app.mockInput.pressEscape()
    await Bun.sleep(20)
    expect(prompt.textarea.plainText).toBe(DRAFT)
    await wait(() => prompt.app.captureCharFrame().includes("again to clear"))

    prompt.app.mockInput.pressEscape()
    await wait(() => prompt.textarea.plainText === "")
    await wait(() => !prompt.app.captureCharFrame().includes("again to clear"))

    prompt.app.mockInput.pressKey("ARROW_UP")
    await wait(() => prompt.textarea.plainText === DRAFT)
  } finally {
    await prompt.cleanup()
  }
})

test("escape presses outside the double-press window do not clear the input", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt({ root: tmp.path })

  try {
    await prompt.app.mockInput.typeText(DRAFT)
    await wait(() => prompt.textarea.plainText === DRAFT)

    prompt.app.mockInput.pressEscape()
    await Bun.sleep(600)
    prompt.app.mockInput.pressEscape()
    await Bun.sleep(50)
    expect(prompt.textarea.plainText).toBe(DRAFT)
  } finally {
    await prompt.cleanup()
  }
})

test("double escape does nothing when the keybind is disabled", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: { input_clear_double: "none" },
  })

  try {
    await prompt.app.mockInput.typeText(DRAFT)
    await wait(() => prompt.textarea.plainText === DRAFT)

    prompt.app.mockInput.pressEscape()
    prompt.app.mockInput.pressEscape()
    await Bun.sleep(50)
    expect(prompt.textarea.plainText).toBe(DRAFT)
  } finally {
    await prompt.cleanup()
  }
})

test("double escape interrupts instead of clearing while the session is busy", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt({ root: tmp.path, sessionID: "ses_test" })

  try {
    prompt.emit({
      directory,
      project: "proj_test",
      payload: {
        id: "evt_status_busy",
        type: "session.status",
        properties: { sessionID: "ses_test", status: { type: "busy" } },
      },
    } satisfies GlobalEvent)

    await prompt.app.mockInput.typeText(DRAFT)
    await wait(() => prompt.textarea.plainText === DRAFT)

    prompt.app.mockInput.pressEscape()
    prompt.app.mockInput.pressEscape()
    await Bun.sleep(50)
    expect(prompt.textarea.plainText).toBe(DRAFT)
  } finally {
    await prompt.cleanup()
  }
})
