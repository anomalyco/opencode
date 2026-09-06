/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { Preferences } from "@opencode-ai/schema/preferences"
import { Schema } from "effect"
import { DialogSkill } from "../../../src/component/dialog-skill"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { Toast, ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test.each([
  { width: 60, mode: "dark" as const },
  { width: 112, mode: "light" as const },
])("opens, toggles, resets, and selects skills at $width columns in $mode mode", async (options) => {
  const fixture = await renderSkills(options)
  try {
    await fixture.app.waitForFrame((frame) => frame.includes("2. Toggle skills"))
    fixture.app.mockInput.pressKey("2")
    const initial = await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Enabled ✓"))
    expect(initial).not.toContain("[x]")
    await fixture.app.mockInput.typeText("   ")
    const spaces = await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Review"))
    expect(spaces).not.toContain("No skills found")
    await fixture.app.mockInput.typeText("gui eff ")
    const filtered = await fixture.app.waitForFrame((frame) => frame.includes("Effect") && !frame.includes("Review"))
    expect(filtered).toContain("Enabled ✓")
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Disabled ○"))
    expect(fixture.state.preference).toBe("disabled")
    expect(fixture.state.writes).toEqual(["PUT"])

    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Enabled ✓"))
    expect(fixture.state.preference).toBe("enabled")
    fixture.app.mockInput.pressKey("r", { ctrl: true })
    await fixture.app.waitFor(() => fixture.state.preference === undefined)
    await fixture.app.waitForFrame((frame) => frame.includes("Enabled ✓") && !frame.includes("Saving"))
    expect(fixture.state.preference).toBeUndefined()
    expect(fixture.state.writes).toEqual(["PUT", "PUT", "DELETE"])

    await fixture.app.mockInput.typeText("-no-match")
    await fixture.app.waitForFrame((frame) => frame.includes("No skills found"))
    fixture.app.mockInput.pressKey("r", { ctrl: true })
    await fixture.app.renderOnce()
    expect(fixture.state.writes).toEqual(["PUT", "PUT", "DELETE"])
    fixture.app.mockInput.pressKey("c", { ctrl: true })
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Review"))
    await fixture.app.mockInput.typeText("effect")

    fixture.state.preference = "disabled"
    fixture.events.emit({
      id: "evt_external_preference",
      type: "preferences.updated",
      created: 1,
      data: { target: { kind: "skill", id: "effect" } },
    })
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Disabled ○"))
    fixture.open()
    await fixture.app.waitForFrame((frame) => frame.includes("1. List skills"))
    fixture.app.mockInput.pressKey("1")
    const frame = await fixture.app.waitForFrame((frame) => frame.includes("Review"))
    expect(frame).not.toContain("Effect")
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.state.selected === "review")
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("keeps the skill state and dialog usable after a failed save", async () => {
  const fixture = await renderSkills({ width: 100, mode: "dark" })
  try {
    await fixture.app.waitForFrame((frame) => frame.includes("2. Toggle skills"))
    fixture.app.mockInput.pressKey("2")
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Enabled ✓"))
    fixture.state.fail = true
    fixture.app.mockInput.pressEnter()
    const frame = await fixture.app.waitForFrame((frame) => frame.includes("Could not update skill"))
    expect(frame).toContain("Enabled ✓")
    expect(fixture.state.preference).toBeUndefined()
    fixture.state.fail = false
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Disabled ○"))
  } finally {
    fixture.app.renderer.destroy()
  }
})

async function renderSkills(options: { width: number; mode: "light" | "dark" }) {
  const events = createEventStream()
  const state = {
    preference: undefined as Preferences.State | undefined,
    writes: [] as string[],
    fail: false,
    selected: "",
  }
  const location = { directory: process.cwd() }
  const skills = ["effect", "review"].map((id) => ({
    id,
    name: id === "effect" ? "Effect" : "Review",
    description: `Use ${id} guidance`,
    content: "Fixture guidance",
    location: `/skills/${id}.md`,
  }))
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/preferences")
      return json(state.preference ? [{ target: { kind: "skill", id: "effect" }, state: state.preference }] : [])
    if (url.pathname === "/api/preferences/skill/effect") {
      if (state.fail) return json({ message: "Save failed" }, { status: 500 })
      state.writes.push(request.method)
      state.preference =
        request.method === "DELETE"
          ? undefined
          : Schema.decodeUnknownSync(Schema.Struct({ state: Preferences.State }))(await request.json()).state
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/skill")
      return json({
        location,
        data: skills,
      })
    return undefined
  }, events)
  let open!: () => void
  function Probe() {
    const dialog = useDialog()
    open = () => dialog.replace(() => <DialogSkill onSelect={(id) => (state.selected = id)} />)
    onMount(open)
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <ClientProvider api={createApi(calls.fetch)}>
                <DataProvider directory={location.directory}>
                  <ThemeProvider mode={options.mode} source={emptyThemeSource}>
                    <DialogProvider>
                      <Probe />
                    </DialogProvider>
                    <Toast />
                  </ThemeProvider>
                </DataProvider>
              </ClientProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: options.width, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  return { app, state, events, open: () => open() }
}
