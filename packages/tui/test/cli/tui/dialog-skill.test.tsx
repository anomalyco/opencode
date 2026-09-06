/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { Skill } from "@opencode-ai/schema/skill"
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

test("toggles, resets, and selects available skills", async () => {
  const fixture = await renderSkills()
  try {
    await fixture.app.waitForFrame((frame) => frame.includes("2. Toggle skills"))
    fixture.app.mockInput.pressKey("2")
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Enabled ✓"))
    await fixture.app.mockInput.typeText("effect")
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Disabled ○"))
    expect(fixture.state.preference).toBe("disabled")

    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Enabled ✓"))
    expect(fixture.state.preference).toBe("enabled")
    fixture.app.mockInput.pressKey("r", { ctrl: true })
    await fixture.app.waitFor(() => fixture.state.preference === undefined)
    await fixture.app.waitForFrame((frame) => frame.includes("Enabled ✓") && !frame.includes("Saving"))

    await fixture.app.mockInput.typeText("-no-match")
    await fixture.app.waitForFrame((frame) => frame.includes("No skills found"))
    fixture.app.mockInput.pressKey("r", { ctrl: true })
    await fixture.app.renderOnce()
    expect(fixture.state.writes).toEqual(["PUT", "PUT", "DELETE"])
    fixture.app.mockInput.pressKey("c", { ctrl: true })
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("Review"))
    await fixture.app.mockInput.typeText("effect")

    fixture.app.mockInput.pressEnter()
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
  const fixture = await renderSkills()
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

async function renderSkills() {
  const events = createEventStream()
  const state = {
    preference: undefined as Skill.Activation | undefined,
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
      return json(
        state.preference ? [{ target: { kind: "skill.activation", id: "effect" }, value: state.preference }] : [],
      )
    if (url.pathname === "/api/preferences/skill.activation/effect") {
      if (state.fail) return json({ message: "Save failed" }, { status: 500 })
      state.writes.push(request.method)
      state.preference =
        request.method === "DELETE"
          ? undefined
          : Schema.decodeUnknownSync(Schema.Struct({ value: Skill.Activation }))(await request.json()).value
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
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
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
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  return { app, state, open: () => open() }
}
