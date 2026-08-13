import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Group } from "../src/group.js"
import { Pty } from "../src/pty.js"
import { Session } from "../src/session.js"

describe("Group", () => {
  test("creates branded group IDs", () => {
    expect(Group.ID.create()).toStartWith("grp_")
    expect(() => Schema.decodeUnknownSync(Group.ID)("ses_invalid")).toThrow()
  })

  test("preserves one ordered session and terminal item list", () => {
    const group = Schema.decodeUnknownSync(Group.Info)({
      id: Group.ID.create(),
      items: [
        { type: "session", id: Session.ID.make("ses_one") },
        { type: "terminal", id: Pty.ID.make("pty_one") },
        { type: "session", id: Session.ID.make("ses_two") },
      ],
    })

    expect(group.items.map((item) => item.type)).toEqual(["session", "terminal", "session"])
    expect(() =>
      Schema.decodeUnknownSync(Group.Info)({
        id: group.id,
        items: [{ type: "other", id: "other_one" }],
      }),
    ).toThrow()
  })
})
