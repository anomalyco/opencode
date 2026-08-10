import { describe, expect, test } from "bun:test"
import { parseMermaidStateDiagram } from "./parser.js"
import { prepareVisibleStateDiagram } from "./visible-model.js"

describe("prepareVisibleStateDiagram", () => {
  test("collapses composite marker transitions", () => {
    const parsed = parseMermaidStateDiagram(`stateDiagram-v2
  [*] --> Authenticated: login
  state Authenticated {
    [*] --> Idle
    Idle --> Editing: open
    Editing --> [*]: save
  }
  Authenticated --> [*]: logout`)

    const visible = prepareVisibleStateDiagram(parsed)
    const entry = visible.transitions.find((transition) => transition.from === "__start")
    const exit = visible.transitions.find((transition) => transition.to === "__end")

    expect(visible.states.some((state) => state.id === "Authenticated.__start")).toBe(false)
    expect(visible.states.some((state) => state.id === "Authenticated.__end")).toBe(false)
    expect(entry).toMatchObject({ from: "__start", to: "Idle", label: "login" })
    expect(exit).toMatchObject({ from: "Editing", to: "__end", label: "save" })
  })
})
