/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { onCleanup, onMount } from "solid-js"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { ProjectProvider, useProject } from "../../../src/cli/cmd/tui/context/project"
import { SDKProvider } from "../../../src/cli/cmd/tui/context/sdk"
import { KVProvider } from "../../../src/cli/cmd/tui/context/kv"
import { ThemeProvider } from "../../../src/cli/cmd/tui/context/theme"
import { TuiConfigProvider } from "../../../src/cli/cmd/tui/context/tui-config"
import {
  OpencodeKeymapProvider,
  registerOpencodeKeymap,
} from "../../../src/cli/cmd/tui/keymap"
import { QuestionPrompt } from "../../../src/cli/cmd/tui/routes/session/question"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createFetch, directory, json } from "../../fixture/tui-sdk"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

const request: QuestionRequest = {
  id: "que_test",
  sessionID: "ses_test",
  questions: [
    {
      header: "Routing",
      question: "Pick one",
      options: [
        {
          label: "A",
          description: "First option",
        },
      ],
      custom: false,
    },
  ],
}

const multipleRequest: QuestionRequest = {
  id: "que_test",
  sessionID: "ses_test",
  questions: [
    {
      header: "Routing",
      question: "Pick many",
      options: [
        {
          label: "A",
          description: "First option",
        },
        {
          label: "B",
          description: "Second option",
        },
      ],
      multiple: true,
      custom: false,
    },
  ],
}

test("question prompt replies through the active workspace", async () => {
  await mkdir(Global.Path.state, { recursive: true })
  await Bun.write(path.join(Global.Path.state, "kv.json"), "{}")

  const replies: URL[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/question/que_test/reply") {
      replies.push(url)
      return json(true)
    }
  })

  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <TuiConfigProvider config={config}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <SDKProvider url="http://test" directory={directory} fetch={calls.fetch}>
                <ProjectProvider>
                  <Probe onReady={ready} />
                  <QuestionPrompt request={request} />
                </ProjectProvider>
              </SDKProvider>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </OpencodeKeymapProvider>
    )
  }

  function Probe(props: { onReady: () => void }) {
    const project = useProject()
    onMount(async () => {
      await project.sync()
      project.workspace.set("ws_question")
      props.onReady()
    })
    return <box />
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  try {
    await mounted

    app.mockInput.pressEnter()
    await wait(() => replies.length === 1)

    expect(replies[0]?.searchParams.get("workspace")).toBe("ws_question")
  } finally {
    app.renderer.destroy()
  }
})

test("multiple question prompt replies through the active workspace", async () => {
  await mkdir(Global.Path.state, { recursive: true })
  await Bun.write(path.join(Global.Path.state, "kv.json"), "{}")

  const replies: URL[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/question/que_test/reply") {
      replies.push(url)
      return json(true)
    }
  })

  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <TuiConfigProvider config={config}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <SDKProvider url="http://test" directory={directory} fetch={calls.fetch}>
                <ProjectProvider>
                  <Probe onReady={ready} />
                  <QuestionPrompt request={multipleRequest} />
                </ProjectProvider>
              </SDKProvider>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </OpencodeKeymapProvider>
    )
  }

  function Probe(props: { onReady: () => void }) {
    const project = useProject()
    onMount(async () => {
      await project.sync()
      project.workspace.set("ws_question")
      props.onReady()
    })
    return <box />
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  try {
    await mounted

    app.mockInput.pressEnter()
    app.mockInput.pressKey("l")
    app.mockInput.pressEnter()
    await wait(() => replies.length === 1)

    expect(replies[0]?.searchParams.get("workspace")).toBe("ws_question")
  } finally {
    app.renderer.destroy()
  }
})

test("question prompt rejects through the active workspace", async () => {
  await mkdir(Global.Path.state, { recursive: true })
  await Bun.write(path.join(Global.Path.state, "kv.json"), "{}")

  const rejects: URL[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/question/que_test/reject") {
      rejects.push(url)
      return json(true)
    }
  })

  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <TuiConfigProvider config={config}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <SDKProvider url="http://test" directory={directory} fetch={calls.fetch}>
                <ProjectProvider>
                  <Probe onReady={ready} />
                  <QuestionPrompt request={request} />
                </ProjectProvider>
              </SDKProvider>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </OpencodeKeymapProvider>
    )
  }

  function Probe(props: { onReady: () => void }) {
    const project = useProject()
    onMount(async () => {
      await project.sync()
      project.workspace.set("ws_question")
      props.onReady()
    })
    return <box />
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  try {
    await mounted

    app.mockInput.pressEscape()
    await wait(() => rejects.length === 1)

    expect(rejects[0]?.searchParams.get("workspace")).toBe("ws_question")
  } finally {
    app.renderer.destroy()
  }
})
