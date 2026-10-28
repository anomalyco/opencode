import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { timelinePresets } from "./detail"
import { Timeline } from "./projection"
import { userMessageRuns, type UserRunMember } from "./user-runs"

const user = (id: string, created: number) =>
  ({ id, type: "user", text: id, time: { created } }) satisfies SessionMessageInfo

const assistant = (id: string, parentID: string, created: number) =>
  ({
    id,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    metadata: { parentID },
    content: [{ type: "text", text: "answer" }],
    time: { created, completed: created + 1 },
  }) satisfies SessionMessageInfo

const sent: UserRunMember = {
  kind: "sent",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  text: true,
  attachments: false,
}

function runs(
  messages: SessionMessageInfo[],
  members: Record<string, Partial<UserRunMember>> = {},
  preset?: (typeof timelinePresets)[number]["id"],
) {
  const pending = new Set(Object.keys(members).filter((id) => members[id]?.kind === "pending"))
  const detail = timelinePresets.find((item) => item.id === preset)?.value

  const rows = Timeline.constructSessionMessageRows(
    messages,
    true,
    { type: "busy" },
    pending,
    false,
    false,
    undefined,
    detail,
  ).rows

  return Object.fromEntries(userMessageRuns(rows, messages, (id) => ({ ...sent, ...members[id] })))
}

const alone = { above: false, below: false }

describe("userMessageRuns", () => {
  test("joins consecutive sent messages into one run", () => {
    expect(runs([user("msg_1", 1), user("msg_2", 2), user("msg_3", 3)])).toEqual({
      msg_1: { above: false, below: true },
      msg_2: { above: true, below: true },
      msg_3: { above: true, below: false },
    })
  })

  test("assistant output between two messages ends the run", () => {
    expect(runs([user("msg_1", 1), assistant("msg_2", "msg_1", 2), user("msg_3", 3), user("msg_4", 4)])).toEqual({
      msg_1: alone,
      msg_3: { above: false, below: true },
      msg_4: { above: true, below: false },
    })
  })

  test("waiting steers group together but never with a sent message", () => {
    expect(
      runs([user("msg_1", 1), user("msg_2", 2), user("msg_3", 3), user("msg_4", 4)], {
        msg_3: { kind: "pending" },
        msg_4: { kind: "pending" },
      }),
    ).toEqual({
      msg_1: { above: false, below: true },
      msg_2: { above: true, below: false },
      msg_3: { above: false, below: true },
      msg_4: { above: true, below: false },
    })
  })

  test("a run of steers stays one run as it delivers", () => {
    const steers = [user("msg_1", 1), assistant("msg_2", "msg_1", 2), user("msg_3", 3), user("msg_4", 4)]

    const delivered = { msg_1: alone, msg_3: { above: false, below: true }, msg_4: { above: true, below: false } }

    expect(runs(steers, { msg_3: { kind: "pending" }, msg_4: { kind: "pending" } })).toEqual(delivered)
    expect(runs(steers)).toEqual(delivered)
  })

  test("a steer delivered ahead of the rest leaves the run", () => {
    expect(
      runs([user("msg_1", 1), assistant("msg_2", "msg_1", 2), user("msg_3", 3), user("msg_4", 4), user("msg_5", 5)], {
        msg_4: { kind: "pending" },
        msg_5: { kind: "pending" },
      }),
    ).toEqual({
      msg_1: alone,
      msg_3: alone,
      msg_4: { above: false, below: true },
      msg_5: { above: true, below: false },
    })
  })

  test("a different agent or model ends the run, since the run names one", () => {
    expect(
      runs([user("msg_1", 1), user("msg_2", 2), user("msg_3", 3)], {
        msg_2: { agent: "plan" },
        msg_3: { agent: "plan", model: { id: "model", providerID: "provider", variant: "high" } },
      }),
    ).toEqual({ msg_1: alone, msg_2: alone, msg_3: alone })
  })

  test("a switch or compaction ends the run even when the timeline hides its notice", () => {
    const messages = [
      user("msg_1", 1),
      { id: "msg_2", type: "model-switched", model: { id: "model", providerID: "provider" }, time: { created: 2 } },
      user("msg_3", 3),
    ] satisfies SessionMessageInfo[]

    expect(runs(messages, {}, "quiet")).toEqual({ msg_1: alone, msg_3: alone })
  })

  test("only text bubbles join; attachments keep their own gap and the text above keeps its meta line", () => {
    expect(
      runs([user("msg_1", 1), user("msg_2", 2), user("msg_3", 3), user("msg_4", 4)], {
        msg_2: { text: false, attachments: true },
        msg_4: { attachments: true },
      }),
    ).toEqual({ msg_1: alone, msg_2: alone, msg_3: alone, msg_4: alone })
  })

  test("a lone message stands alone", () => {
    expect(runs([user("msg_1", 1), assistant("msg_2", "msg_1", 2)])).toEqual({ msg_1: alone })
  })
})
