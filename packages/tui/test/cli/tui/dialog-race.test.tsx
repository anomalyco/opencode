/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"

async function wait(fn: () => boolean, timeout = 3000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountDialog(root: string, kind: "race" | "status" = "race") {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const calls = createFetch()
  const events = createEventSource()
  const [
    { ArgsProvider },
    { DialogProvider, useDialog },
    { DialogRace },
    { DialogRaceStatus },
    { KVProvider },
    { PermissionProvider },
    { ProjectProvider },
    { ExitProvider },
    { SDKProvider },
    { SyncProvider, useSync },
    { ThemeProvider },
    { ToastProvider },
    { TuiConfigProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../../src/context/args"),
    import("../../../src/ui/dialog"),
    import("../../../src/component/dialog-race"),
    import("../../../src/component/dialog-race-status"),
    import("../../../src/context/kv"),
    import("../../../src/context/permission"),
    import("../../../src/context/project"),
    import("../../../src/context/exit"),
    import("../../../src/context/sdk"),
    import("../../../src/context/sync"),
    import("../../../src/context/theme"),
    import("../../../src/ui/toast"),
    import("../../../src/config"),
    import("../../../src/keymap"),
  ])

  let ready!: () => void
  const synced = new Promise<void>((resolve) => (ready = resolve))

  function Probe() {
    const sync = useSync()
    onMount(() => {
      void wait(() => sync.status === "complete").then(ready)
    })
    return <box />
  }

  function OpenRace() {
    const dialog = useDialog()
    onMount(() => {
      dialog.replace(() => (kind === "race" ? <DialogRace /> : <DialogRaceStatus />))
    })
    return <box />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ArgsProvider>
          <KVProvider>
            <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
              <PermissionProvider>
                <ProjectProvider>
                  <ExitProvider exit={() => {}}>
                    <SyncProvider>
                      <OpencodeKeymapProvider keymap={keymap}>
                        <TuiConfigProvider config={config}>
                          <ThemeProvider mode="dark">
                            <ToastProvider>
                              <DialogProvider>
                                <Probe />
                                <OpenRace />
                              </DialogProvider>
                            </ToastProvider>
                          </ThemeProvider>
                        </TuiConfigProvider>
                      </OpencodeKeymapProvider>
                    </SyncProvider>
                  </ExitProvider>
                </ProjectProvider>
              </PermissionProvider>
            </SDKProvider>
          </KVProvider>
        </ArgsProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  await synced
  return {
    app,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

test("race menu enters candidate models on return", async () => {
  await using tmp = await tmpdir()
  const race = await mountDialog(tmp.path)

  try {
    await race.app.waitForFrame((frame) => frame.includes("Model Racing"))
    race.app.mockInput.pressArrow("down")
    race.app.mockInput.pressEnter()
    await race.app.waitForFrame((frame) => frame.includes("Racing models"))
  } finally {
    await race.cleanup()
  }
})

test("race menu enters warmup tokens editor on return", async () => {
  await using tmp = await tmpdir()
  const race = await mountDialog(tmp.path)

  try {
    await race.app.waitForFrame((frame) => frame.includes("Model Racing"))

    for (let i = 0; i < 5; i++) race.app.mockInput.pressArrow("down")
    race.app.mockInput.pressEnter()
    await race.app.waitForFrame((frame) => frame.includes("Positive integer before throughput measurement starts"))
  } finally {
    await race.cleanup()
  }
})

test("race menu enters measurement window editor on return", async () => {
  await using tmp = await tmpdir()
  const race = await mountDialog(tmp.path)

  try {
    await race.app.waitForFrame((frame) => frame.includes("Model Racing"))
    for (let i = 0; i < 6; i++) race.app.mockInput.pressArrow("down")
    race.app.mockInput.pressEnter()
    await race.app.waitForFrame((frame) => frame.includes("Duration in milliseconds for each throughput"))

    expect(race.app.captureCharFrame()).toContain("Measurement window")
  } finally {
    await race.cleanup()
  }
})

test("race status manage opens model racing settings", async () => {
  await using tmp = await tmpdir()
  const race = await mountDialog(tmp.path, "status")

  try {
    await race.app.waitForFrame((frame) => frame.includes("Model Racing"))
    race.app.mockInput.pressArrow("down")
    race.app.mockInput.pressEnter()
    await race.app.waitForFrame((frame) => frame.includes("Candidate models"))

    expect(race.app.captureCharFrame()).toContain("Model Racing")
  } finally {
    await race.cleanup()
  }
})
