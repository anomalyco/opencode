/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { KVProvider } from "../../../src/cli/cmd/tui/context/kv"
import { SDKProvider } from "../../../src/cli/cmd/tui/context/sdk"
import { ThemeProvider } from "../../../src/cli/cmd/tui/context/theme"
import { TuiConfigProvider } from "../../../src/cli/cmd/tui/context/tui-config"
import { getOpencodeModeStack, OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/cli/cmd/tui/keymap"
import { QuestionPrompt } from "../../../src/cli/cmd/tui/routes/session/question"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  })
}

async function mountQuestionPrompt() {
  const tmp = await tmpdir()
  const { Global } = await import("@opencode-ai/core/global")
  const previous = {
    config: Global.Path.config,
    state: Global.Path.state,
  }
  Global.Path.config = path.join(tmp.path, "config")
  Global.Path.state = path.join(tmp.path, "state")
  await mkdir(Global.Path.config, { recursive: true })
  await mkdir(Global.Path.state, { recursive: true })
  await Bun.write(path.join(Global.Path.state, "kv.json"), "{}")

  const replies: unknown[] = []
  const rejects: string[] = []
  let currentMode!: () => string
  let dispatchCommand!: (command: string) => void

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const modeStack = getOpencodeModeStack(keymap)
    const popAutocomplete = modeStack.push("autocomplete")
    currentMode = modeStack.current
    dispatchCommand = (command) => keymap.dispatchCommand(command)

    onCleanup(() => {
      popAutocomplete()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <TuiConfigProvider config={config}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <SDKProvider
                url="http://test"
                fetch={
                  (async (input) => {
                    const request = input instanceof Request ? input : undefined
                    const url = new URL(request?.url ?? String(input))
                    if (url.pathname === "/question/que_test/reply") {
                      replies.push(await request?.json())
                      return json(true)
                    }
                    if (url.pathname === "/question/que_test/reject") {
                      rejects.push(url.pathname)
                      return json(true)
                    }
                    throw new Error(`unexpected request: ${url.pathname}`)
                  }) as typeof globalThis.fetch
                }
                events={{ subscribe: async () => () => {} }}
              >
                <QuestionPrompt
                  request={{
                    id: "que_test",
                    sessionID: "ses_test",
                    questions: [
                      {
                        header: "Choice",
                        question: "Pick one or more",
                        multiple: true,
                        options: [
                          { label: "Alpha", description: "" },
                          { label: "Beta", description: "" },
                        ],
                      },
                    ],
                  }}
                />
              </SDKProvider>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  return {
    app,
    replies,
    rejects,
    currentMode,
    dispatchCommand,
    async cleanup() {
      app.renderer.destroy()
      Global.Path.config = previous.config
      Global.Path.state = previous.state
      await tmp[Symbol.asyncDispose]()
    },
  }
}

test("question prompt enter works when another mode was already active", async () => {
  const prompt = await mountQuestionPrompt()
  try {
    await wait(() => prompt.currentMode() === "question")
    prompt.app.mockInput.pressKey("1")
    prompt.app.mockInput.pressArrow("right")
    prompt.app.mockInput.pressEnter()

    await wait(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answers: [["Alpha"]] }])
  } finally {
    await prompt.cleanup()
  }
})

test("question prompt escape works when another mode was already active", async () => {
  const prompt = await mountQuestionPrompt()
  try {
    await wait(() => prompt.currentMode() === "question")
    prompt.app.mockInput.pressEscape()

    await wait(() => prompt.rejects.length === 1)
    expect(prompt.rejects).toEqual(["/question/que_test/reject"])
  } finally {
    await prompt.cleanup()
  }
})

test("question prompt app.exit command works when another mode was already active", async () => {
  const prompt = await mountQuestionPrompt()
  try {
    await wait(() => prompt.currentMode() === "question")
    prompt.dispatchCommand("app.exit")

    await wait(() => prompt.rejects.length === 1)
    expect(prompt.rejects).toEqual(["/question/que_test/reject"])
  } finally {
    await prompt.cleanup()
  }
})
