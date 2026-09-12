/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { json } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("dialog skill groups skills by source", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const project = path.join(tmp.path, "project")
  await mkdir(project, { recursive: true })

  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/skill")
      return json([
        {
          name: "deploy",
          description: "Deploy the app",
          location: path.join(project, ".opencode", "skill", "deploy", "SKILL.md"),
          content: "",
        },
        {
          name: "review-code",
          description: "Review pending changes",
          location: path.join(tmp.path, "global", "skill", "review-code", "SKILL.md"),
          content: "",
        },
        { name: "customize-opencode", description: "Configure opencode", location: "<built-in>", content: "" },
      ])
    throw new Error(`unexpected request: ${url.pathname}`)
  }) as typeof globalThis.fetch

  const [
    { DialogProvider, useDialog },
    { DialogSkill },
    { KVProvider },
    { LocationProvider },
    { SDKProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../../src/ui/dialog"),
    import("../../../src/component/dialog-skill"),
    import("../../../src/context/kv"),
    import("../../../src/context/location"),
    import("../../../src/context/sdk"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/ui/toast"),
    import("../../../src/keymap"),
  ])

  const selected: string[] = []

  function Content() {
    const dialog = useDialog()
    dialog.replace(() => <DialogSkill onSelect={(skill) => selected.push(skill)} />)
    return <box />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({})
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts directory={project} paths={{ home: tmp.path, state, worktree: project }}>
        <SDKProvider url="http://test" fetch={fetch}>
          <LocationProvider location={{ directory: project }}>
            <OpencodeKeymapProvider keymap={keymap}>
              <TuiConfigProvider config={resolvedConfig}>
                <KVProvider>
                  <ThemeProvider mode="dark">
                    <ToastProvider>
                      <DialogProvider>
                        <Content />
                      </DialogProvider>
                    </ToastProvider>
                  </ThemeProvider>
                </KVProvider>
              </TuiConfigProvider>
            </OpencodeKeymapProvider>
          </LocationProvider>
        </SDKProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true, width: 100, height: 30 })
  try {
    let frame = ""
    await wait(() => {
      app.renderer.requestRender()
      frame = app.captureCharFrame()
      return frame.includes("customize-opencode")
    })

    expect(frame).toContain("Project")
    expect(frame).toContain("Global")
    expect(frame).toContain("Built-in")
    expect(frame).toContain("deploy")
    expect(frame).toContain("review-code")
    expect(frame.indexOf("Project")).toBeLessThan(frame.indexOf("Global"))
    expect(frame.indexOf("Global")).toBeLessThan(frame.indexOf("Built-in"))
  } finally {
    app.renderer.destroy()
  }
})
