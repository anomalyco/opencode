import { describe, expect, test } from "bun:test"
import { extraAgentActive, sidebarExtraAgents } from "./extra-agents"

describe("extra agent routing", () => {
  test("treats the current extra agent as active only when route and integration both match", () => {
    expect(extraAgentActive("hermes", { directory: "/hermes", integration: "hermes", pathname: "/abc/session" })).toBe(
      true,
    )
    expect(
      extraAgentActive("hermes", { directory: "/genericagent", integration: "hermes", pathname: "/abc/session" }),
    ).toBe(false)
    expect(
      extraAgentActive("hermes", { directory: "/hermes", integration: "genericagent", pathname: "/abc/session" }),
    ).toBe(false)
    expect(extraAgentActive("hermes", { directory: "/hermes", integration: "hermes", pathname: "/abc/config" })).toBe(
      false,
    )
  })

  test("shows configurable adapters even before their bridge server is enabled", () => {
    expect(sidebarExtraAgents([], { includeConfigurable: true }).map((agent) => agent.id)).toEqual([
      "openclaw",
      "hermes",
      "genericagent",
    ])
    expect(sidebarExtraAgents([{ integration: "genericagent" }]).map((agent) => agent.id)).toEqual(["genericagent"])
  })
})
