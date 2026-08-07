import { describe, expect, test } from "bun:test"
import { parseMermaidStateDiagram } from "./parser.js"
import { prepareVisibleStateDiagram } from "./visible-model.js"

describe("prepareVisibleStateDiagram", () => {
  test("collapses composite marker transitions while preserving their source path", () => {
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
    expect(entry?.sourceTransitions).toEqual([
      { from: "__start", to: "Authenticated.__start", label: "login" },
      { from: "Authenticated.__start", to: "Idle", label: "" },
    ])
    expect(exit).toMatchObject({ from: "Editing", to: "__end", label: "save" })
    expect(exit?.sourceTransitions).toEqual([
      { from: "Editing", to: "Authenticated.__end", label: "save" },
      { from: "Authenticated.__end", to: "__end", label: "logout" },
    ])
  })
})
