import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import {
  olderMayHoldRevert,
  REVERT_SEARCH_LIMIT,
  selectSessionUserMessages,
  selectVisibleSessionUserMessages,
} from "./session-domain"

const user = (id: string): SessionMessageUser => ({
  id,
  type: "user",
  text: id,
  time: { created: 0 },
})

const assistant: SessionMessageAssistant = {
  id: "msg_2",
  type: "assistant",
  time: { created: 0 },
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}

test("selects the prompts before the revert boundary by their place in the transcript", () => {
  // A scheduled prompt sorts after every other ID, and the last prompt, sent before its turn ended, sorts before it.
  const messages: SessionMessageInfo[] = [user("msg_sch_a"), assistant, user("msg_b"), user("msg_1")]
  const ids = (list: SessionMessageUser[]) => list.map((message) => message.id)

  expect(ids(selectSessionUserMessages(messages))).toEqual(["msg_sch_a", "msg_b", "msg_1"])
  expect(ids(selectVisibleSessionUserMessages(messages, "msg_b", false))).toEqual(["msg_sch_a"])
  // A boundary need not be a prompt.
  expect(ids(selectVisibleSessionUserMessages(messages, "msg_2", false))).toEqual(["msg_sch_a"])
  // A boundary that is not loaded is older than every loaded message while older messages are left to load.
  expect(selectVisibleSessionUserMessages(messages.slice(2), "msg_2", true)).toEqual([])
  // With the whole transcript loaded, the session no longer has that boundary.
  expect(ids(selectVisibleSessionUserMessages(messages.slice(2), "msg_2", false))).toEqual(["msg_b", "msg_1"])
  expect(ids(selectVisibleSessionUserMessages(messages, undefined, true))).toEqual(["msg_sch_a", "msg_b", "msg_1"])
})

test("a revert boundary that is not loaded may be in an older page only up to the search limit", () => {
  expect(olderMayHoldRevert(REVERT_SEARCH_LIMIT - 1, true)).toBe(true)
  // Past the limit the timeline stops looking, so the loaded messages show.
  expect(olderMayHoldRevert(REVERT_SEARCH_LIMIT, true)).toBe(false)
  // No older page is left.
  expect(olderMayHoldRevert(20, false)).toBe(false)
})
