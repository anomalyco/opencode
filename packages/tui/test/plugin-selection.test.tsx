import { describe, expect, test } from "bun:test"
import { renderLocal, model, agent } from "./fixture/local"
import { usePluginDataSelection } from "../src/plugin/api"

describe("plugin data selection", () => {
  test("selection exposes the live model and agent", async () => {
    let selection!: ReturnType<typeof usePluginDataSelection>
    await using fixture = await renderLocal({
      models: [model("first"), model("second")],
      agents: [agent("build"), agent("review")],
      preferences: { recent: [{ providerID: "provider", modelID: "first" }] },
      extraProbe() {
        selection = usePluginDataSelection()
        return <box />
      },
    })

    expect(selection.model()).toEqual({ providerID: "provider", modelID: "first" })
    expect(selection.agent()).toEqual({ id: "build" })

    // Agent swaps reset the model to that agent's own selection (per-agent
    // keying); set the agent first, then the model, so the assertion reads the
    // final state.
    fixture.local.agent.set("review")
    expect(selection.agent()).toEqual({ id: "review" })

    fixture.local.model.set({ providerID: "provider", modelID: "second" })
    expect(selection.model()).toEqual({ providerID: "provider", modelID: "second" })
  })

  test("selection returns undefined when no model or agent is available", async () => {
    let selection!: ReturnType<typeof usePluginDataSelection>
    await using fixture = await renderLocal({
      models: [],
      agents: [],
      preferences: {},
      extraProbe() {
        selection = usePluginDataSelection()
        return <box />
      },
    })

    expect(selection.model()).toBeUndefined()
    expect(selection.agent()).toBeUndefined()
  })

  test("selection reflects the live selection that never round-trips through the session", async () => {
    // Cycling the model in the prompt input must be visible to a plugin before
    // any session.prompt is sent. The server-side SessionInfo.model only
    // mirrors the value that was last sent, which is the gap the fix closes.
    let selection!: ReturnType<typeof usePluginDataSelection>
    await using fixture = await renderLocal({
      models: [model("first"), model("second"), model("third")],
      agents: [agent("build")],
      preferences: { recent: [{ providerID: "provider", modelID: "first" }] },
      extraProbe() {
        selection = usePluginDataSelection()
        return <box />
      },
    })

    expect(selection.model()).toEqual({ providerID: "provider", modelID: "first" })
    fixture.local.model.set({ providerID: "provider", modelID: "second" })
    expect(selection.model()).toEqual({ providerID: "provider", modelID: "second" })
    // No server-side session has been created — the plugin sees the change
    // before any prompt is sent.
    expect(fixture.data.session.list()).toEqual([])
  })
})