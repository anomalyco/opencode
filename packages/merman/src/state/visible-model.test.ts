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
    expect(exit).toMatchObject({ from: "Editing", to: "__end", label: "save<br/>logout" })
  })

  test("collapses nested composite entry chains without retaining scoped markers", () => {
    const visible = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  state Session {
    [*] --> Open
    state Open {
      [*] --> Clean
      Clean --> Dirty: edit
      Dirty --> Clean: save
    }
    Open --> [*]: close
  }
  [*] --> Session
  Session --> [*]`),
    )

    expect(visible.states.map((state) => state.id)).toEqual(["Clean", "Dirty", "__start", "__end"])
    expect(visible.transitions).toContainEqual({ from: "__start", to: "Clean", label: "" })
    expect(visible.transitions.some((transition) => transition.from.includes(".__start"))).toBe(false)
    expect(visible.transitions.some((transition) => transition.to.includes(".__start"))).toBe(false)
  })

  test("preserves labels on both sides of collapsed composite markers", () => {
    const visible = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  [*] --> Session: open session
  state Session {
    [*] --> Ready: initialize
    Ready --> [*]: finalize
  }
  Session --> [*]: close session`),
    )

    expect(visible.transitions).toContainEqual({ from: "__start", to: "Ready", label: "open session<br/>initialize" })
    expect(visible.transitions).toContainEqual({ from: "Ready", to: "__end", label: "finalize<br/>close session" })
  })
})
