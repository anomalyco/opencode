import { describe, expect, test } from "bun:test"
import { createNewSessionMcps, createNewSessionSkills } from "./controller"

const servers = [
  { id: "b", name: "b", status: "connected" },
  { id: "a", name: "a", status: "disabled" },
  { id: "c", name: "c", status: "needs_auth" },
]

describe("new session MCPs", () => {
  test("a server starts enabled unless disabled, and an explicit choice wins", () => {
    const mcps = createNewSessionMcps({
      servers: () => servers,
      states: () => ({ a: true, b: false }),
      pending: () => false,
      change: () => undefined,
    })

    expect(mcps.items().map((server) => server.id)).toEqual(["a", "b", "c"])
    expect(servers.map((server) => mcps.enabled(server))).toEqual([false, true, true])
    expect(mcps.count()).toBe(2)
  })
})

describe("new session skills", () => {
  test("disabling and re-enabling a skill updates the disabled list and the count", () => {
    let disabled: string[] = ["old"]
    const skills = createNewSessionSkills({
      skills: () => ["old", "new"].map((id) => ({ id, name: id })),
      disabled: () => disabled,
      setDisabled: (ids) => (disabled = ids),
    })

    expect(skills.count()).toBe(1)

    skills.toggle("new", false)
    expect(disabled).toEqual(["old", "new"])
    expect(skills.count()).toBe(0)

    skills.toggle("old", true)
    expect(disabled).toEqual(["new"])
    expect(skills.count()).toBe(1)
  })
})
