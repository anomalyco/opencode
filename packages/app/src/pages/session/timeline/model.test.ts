import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"
import { isTimelineReady, loadOlderTimeline, selectUserMessages, selectVisibleUserMessages } from "./model"
import { closureTimelineMessageID, selectActiveTimelineMessageID, selectTimelineUserMessages } from "./closure"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const user = (id: string) => ({ id, role: "user" }) as UserMessage
const assistant = (id: string) => ({ id, role: "assistant" }) as AssistantMessage

function closureRows(): { info: UserMessage; parts: Part[] }[] {
  const sessionID = "ses_closure_app"
  const message = (id: string) =>
    ({
      id,
      sessionID,
      role: "user",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      time: { created: 1 },
    }) as UserMessage
  const text = (messageID: string, value: string, synthetic = false, metadata?: Record<string, unknown>): Part => ({
    id: `part_${messageID}`,
    sessionID,
    messageID,
    type: "text",
    text: value,
    ...(synthetic ? { synthetic: true } : {}),
    ...(metadata ? { metadata } : {}),
  })
  const closure = message("msg_1_closure")
  const payload = {
    version: 1,
    freeze_owner_operation_id: "op_app",
    generation: 1,
    fact_key: "self:ses_closure_app",
    identity_source: "session_identity",
    record_kind: "self",
    subject_session_id: sessionID,
    terminal_outcome: "cancelled",
  }
  const human = message("msg_2_human")
  const synthetic = message("msg_3_synthetic")
  const malformed = message("msg_4_malformed")
  const partial = message("msg_5_partial")
  return [
    {
      info: closure,
      parts: [
        text(
          closure.id,
          "[Branch closure] This Session's prior Task execution: Cancellation won physical closure.",
          true,
          { [CLOSURE_RECORD_METADATA_KEY]: payload },
        ),
      ],
    },
    { info: human, parts: [text(human.id, "ordinary human row")] },
    { info: synthetic, parts: [text(synthetic.id, "ordinary synthetic row", true)] },
    {
      info: malformed,
      parts: [
        text(malformed.id, "malformed lookalike has distinct text", true, {
          [CLOSURE_RECORD_METADATA_KEY]: payload,
        }),
      ],
    },
    {
      info: partial,
      parts: [
        text(partial.id, "multipart lookalike first distinct text", true, {
          [CLOSURE_RECORD_METADATA_KEY]: payload,
        }),
        { ...text(partial.id, "multipart lookalike second distinct text", true), id: "part_partial_second" },
      ],
    },
  ]
}

function region(source: string, start: string, end: string) {
  const from = source.indexOf(start)
  expect(from).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe("timeline model", () => {
  test("selects users and applies the revert boundary", () => {
    const messages: Message[] = [user("msg_z"), assistant("msg_a"), user("msg_b"), user("msg_c")]
    const users = selectUserMessages(messages, () => [])

    expect(users.map((message) => message.id)).toEqual(["msg_z", "msg_b", "msg_c"])
    expect(selectVisibleUserMessages(users, "msg_b").map((message) => message.id)).toEqual(["msg_z"])
    expect(selectVisibleUserMessages(users)).toBe(users)
  })

  test("classifies only the genuine closure pair outside the human timeline", () => {
    const rows = closureRows()
    const parts = new Map(rows.map((row) => [row.info.id, row.parts]))
    const human = selectUserMessages(
      rows.map((row) => row.info),
      (messageID) => parts.get(messageID) ?? [],
    )

    expect(human.map((message) => message.id)).toEqual([
      "msg_2_human",
      "msg_3_synthetic",
      "msg_4_malformed",
      "msg_5_partial",
    ])

    expect(rows.map((row) => closureTimelineMessageID(row.info, row.parts))).toEqual([
      "msg_1_closure",
      undefined,
      undefined,
      undefined,
      undefined,
    ])

    const timeline = selectTimelineUserMessages(
      rows.map((row) => row.info),
      human,
      (messageID) => parts.get(messageID) ?? [],
    )
    expect(timeline.map((message) => message.id)).toEqual(rows.map((row) => row.info.id))

    const pendingClosure = {
      id: "msg_6_pending_closure",
      role: "assistant",
      parentID: rows[0]!.info.id,
      time: { created: 2 },
    } as AssistantMessage
    const pendingHuman = {
      id: "msg_7_pending_human",
      role: "assistant",
      parentID: rows[1]!.info.id,
      time: { created: 3 },
    } as AssistantMessage
    expect(selectActiveTimelineMessageID([...timeline, pendingClosure], human, { type: "busy" })).toBe("msg_5_partial")
    expect(selectActiveTimelineMessageID([...timeline, pendingHuman], human, { type: "busy" })).toBe("msg_2_human")
    expect(selectActiveTimelineMessageID([...timeline.slice(1), timeline[0]!], human, { type: "busy" })).toBe(
      "msg_5_partial",
    )
    expect(selectActiveTimelineMessageID(timeline, human, { type: "idle" })).toBeUndefined()
  })

  test("production human-turn consumers use the shared discriminator", () => {
    const model = readFileSync(fileURLToPath(new URL("./model.ts", import.meta.url)), "utf8")
    expect(model).toContain("return selectHumanUserMessages(messages, parts)")
    expect(model).toContain("selectUserMessages(messages(), (messageID) => sync().data.part[messageID] ?? [])")

    const rows = readFileSync(fileURLToPath(new URL("./rows.ts", import.meta.url)), "utf8")
    const constructFrom = rows.indexOf("export function constructMessageRows")
    expect(constructFrom).toBeGreaterThan(-1)
    const construct = rows.slice(constructFrom)
    expect(construct).toContain("if (closureTimelineMessageID(userMessage, userParts)) {")
    expect(construct.indexOf("closureTimelineMessageID(userMessage, userParts)")).toBeLessThan(
      construct.indexOf("MessageComment.fromPart"),
    )
    expect(construct.indexOf("closureTimelineMessageID(userMessage, userParts)")).toBeLessThan(
      construct.indexOf("const previousUserMessage"),
    )
    expect(construct).toContain("new TimelineRow.ClosureEvidence")

    const projection = readFileSync(fileURLToPath(new URL("./projection.ts", import.meta.url)), "utf8")
    expect(projection).toContain("selectActiveTimelineMessageID(input.messages(), input.userMessages(), input.status())")
    expect(projection).toContain("selectTimelineUserMessages(input.messages(), input.userMessages(), input.parts)")

    const timeline = readFileSync(fileURLToPath(new URL("./message-timeline.tsx", import.meta.url)), "utf8")
    const closure = region(timeline, 'case "ClosureEvidence"', 'case "CommentStrip"')
    expect(closure).toContain("<Message message={message()} parts={getMsgParts")
    expect(closure).not.toContain("actions=")
    expect(closure).not.toContain("data-message-id")
    expect(timeline).toContain('case "UserMessage"')

    const commands = readFileSync(fileURLToPath(new URL("../use-session-commands.tsx", import.meta.url)), "utf8")
    expect(commands).toContain("selectHumanUserMessages(messages()")
    expect(
      region(commands, "const undo = async", "const compact = async").match(/const messages = userMessages\(\)/g),
    ).toHaveLength(2)

    const fork = readFileSync(fileURLToPath(new URL("../../../components/dialog-fork.tsx", import.meta.url)), "utf8")
    expect(fork).toContain("if (!isHumanUserMessage(message, parts)) continue")
    expect(fork).toContain("!x.synthetic && !x.ignored")

    for (const path of ["../../../pages/layout/sidebar-items.tsx", "../../../components/session/session-header.tsx"]) {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
      expect(source).toContain("selectHumanUserMessages(")
      expect(source).toContain("messageAgentColor(human")
    }

    for (const path of [
      "../../../components/prompt-input.tsx",
      "../../../components/session/session-context-tab.tsx",
    ]) {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
      expect(source).toContain("selectHumanUserMessages(")
    }

    const context = readFileSync(
      fileURLToPath(new URL("../../../components/session/session-context-tab.tsx", import.meta.url)),
      "utf8",
    )
    const counts = region(context, "const counts = createMemo", "const systemPrompt = createMemo")
    expect(counts).toContain("user: userMessages().length")
    expect(counts).not.toContain('x.role === "user"')
  })

  test("waits for an assistant-only load to hydrate its user root", () => {
    expect(isTimelineReady([assistant("msg_2")], true)).toBe(false)
    expect(isTimelineReady([user("msg_1"), assistant("msg_2")], true)).toBe(true)
    expect(isTimelineReady([], false)).toBe(true)
  })

  test("loads exactly one opaque cursor page", async () => {
    let calls = 0
    const anchors: Array<string | boolean> = []

    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
      before: () => anchors.push("before"),
      after: (done) => anchors.push("after", done),
    })

    expect(calls).toBe(1)
    expect(anchors).toEqual(["before", "after", true])
  })

  test("stops when a page adds no raw messages", async () => {
    let calls = 0
    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(1)
  })

  test("does not restore an anchor after the session changes", async () => {
    let sessionID = "ses_old"
    let restore = 0

    await loadOlderTimeline({
      sessionID: () => sessionID,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        sessionID = "ses_new"
      },
      after: () => {
        restore += 1
      },
    })

    expect(restore).toBe(0)
  })

  test("releases the anchor when loading history fails", async () => {
    let restore = 0

    await expect(
      loadOlderTimeline({
        sessionID: () => "ses_test",
        more: () => true,
        loading: () => false,
        loadMore: async () => {
          throw new Error("history failed")
        },
        after: () => {
          restore += 1
        },
      }),
    ).rejects.toThrow("history failed")

    expect(restore).toBe(1)
  })
})
