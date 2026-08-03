import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { agentControlVisible } from "./prompt-input-v2"

test("shows the agent control when visibility becomes enabled", () => {
  createRoot((dispose) => {
    const [visible, setVisible] = createSignal(false)

    expect(agentControlVisible(visible, ["build", "plan"])).toBe(false)
    setVisible(true)
    expect(agentControlVisible(visible, ["build", "plan"])).toBe(true)

    dispose()
  })
})