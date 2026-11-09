import { afterEach, expect, setSystemTime, test } from "bun:test"
import { ReplyWatch } from "./replies"
import { TranscriptTail } from "./tail"
import { history, speech } from "./fixtures/history"

afterEach(() => setSystemTime())

test("recorded history attributes the final reply and never replays a heard result", () => {
  const watch = new ReplyWatch()
  watch.sent({
    sessionID: "ses_original",
    promptID: "msg_recorded_18",
    title: "Original session",
    instruction: "Second request",
  })
  expect(watch.reconcile("ses_original", history.slice(0, 7))).toEqual([])
  expect(watch.reconcile("ses_other", history)).toEqual([])
  expect(watch.reconcile("ses_original", history)).toEqual([
    {
      sessionID: "ses_original",
      promptID: "msg_recorded_18",
      title: "Original session",
      instruction: "Second request",
      messageID: "msg_recorded_32",
      text: "Reply 32",
    },
  ])
  watch.heard("ses_original", ["msg_recorded_32"])
  expect(watch.reconcile("ses_original", history)).toEqual([])
})

test("an unrelated later request cannot donate its answer to a voice request", () => {
  const watch = new ReplyWatch()
  watch.sent({ sessionID: "ses_original", promptID: "msg_recorded_0", title: "Original", instruction: "First request" })
  // Replay with the first idle boundary absent, as when steering arrives.
  const interrupted = history.filter((message) => message.id !== "msg_recorded_17")
  expect(watch.reconcile("ses_original", interrupted)).toEqual([])
  expect(watch.reconcile("ses_original", history).map((reply) => reply.messageID)).toEqual(["msg_recorded_16"])
})

test("utterance grouping reserves words and preserves revisions after a delegation", () => {
  const tail = new TranscriptTail()
  setSystemTime(1000)
  tail.append("user", "Please fix")
  setSystemTime(1100)
  expect(tail.append("user", " the call")).toBe("Please fix the call")
  expect(tail.capture("first")).toEqual(["user: Please fix the call"])
  expect(tail.capture("overlap")).toEqual([])
  tail.release("first")
  expect(tail.capture("retry")).toEqual(["user: Please fix the call"])
  tail.append("user", " on Desktop")
  tail.accept("retry")
  expect(tail.capture("continued")).toEqual(["user (updated utterance): Please fix the call on Desktop"])
  tail.accept("continued")
  setSystemTime(5000)
  tail.append("assistant", speech.text)
  expect(tail.capture("answer")).toEqual([`assistant: ${speech.text.trim()}`])
})
