import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { groupTeams, parseTeam, promoteTeam } from "../src/subagent-team"

function session(id: string, title: string, created: number, parentID?: string) {
  return {
    id,
    title,
    parentID,
    agent: "general",
    time: { created, updated: created },
    location: { directory: "/workspace" },
  } as unknown as SessionInfo
}

describe("parseTeam", () => {
  test("parses team sessions titled <team>-<n> (leader|member)", () => {
    expect(parseTeam("usb-output-check-10 (leader) — Task USB output research")).toEqual({
      name: "usb-output-check",
      position: 10,
      role: "leader",
    })
    expect(parseTeam("fb0-ipl2-display-check-2 (member) — verify")).toEqual({
      name: "fb0-ipl2-display-check",
      position: 2,
      role: "member",
    })
  })

  test("ignores titles that are not team sessions", () => {
    expect(parseTeam("@Coder subagent refactor")).toBeUndefined()
    expect(parseTeam("usb-output-check-10 leader")).toBeUndefined()
    expect(parseTeam(undefined)).toBeUndefined()
  })
})

describe("promoteTeam", () => {
  test("inserts a new team at the front and evicts the oldest", () => {
    const slots = { key: ["a", "b", "c", "d"] }
    expect(promoteTeam(slots, "key", "e")).toEqual({ key: ["e", "a", "b", "c"] })
  })

  test("keeps existing slot order when the team is already pinned", () => {
    const slots = { key: ["a", "b", "c"] }
    expect(promoteTeam(slots, "key", "b")).toBe(slots)
  })
})

describe("groupTeams", () => {
  test("pins slot order and fixes sessions inside a team by creation", () => {
    const sessions = [
      session("m2", "beta-2 (member) — work", 30),
      session("a2", "alpha-2 (member) — work", 20),
      session("a1", "alpha-1 (leader) — work", 10),
      session("b1", "beta-1 (leader) — work", 25),
      session("g1", "gamma-1 (leader) — work", 40),
    ]
    const groups = groupTeams(sessions, ["alpha"])
    expect(groups.map((group) => group.team)).toEqual(["alpha", "gamma", "beta"])
    expect(groups[0]!.sessions.map((item) => item.id)).toEqual(["a1", "a2"])
    expect(groups[2]!.sessions.map((item) => item.id)).toEqual(["b1", "m2"])
  })
})
