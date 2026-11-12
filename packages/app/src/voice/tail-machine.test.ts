import { expect, test } from "bun:test"
import {
  capturedLines,
  createTranscriptTailState,
  MAX_UTTERANCES,
  transcriptLines,
  transitionTranscriptTail,
  type TranscriptRole,
  type TranscriptTailEvent,
  type TranscriptTailState,
} from "./tail-machine"

const said = (role: TranscriptRole, delta: string, at: number): TranscriptTailEvent => ({
  type: "utterance.appended",
  role,
  delta,
  at,
})

const captured = (id: string): TranscriptTailEvent => ({ type: "delegation.captured", id })

const accepted = (id: string): TranscriptTailEvent => ({ type: "delegation.accepted", id })

const released = (id: string): TranscriptTailEvent => ({ type: "delegation.released", id })

function replay(events: TranscriptTailEvent[], start = createTranscriptTailState()) {
  return events.reduce(transitionTranscriptTail, start)
}

function capture(state: TranscriptTailState, id: string) {
  const next = transitionTranscriptTail(state, captured(id))

  return { state: next, lines: capturedLines(next, id) }
}

test("a repeated capture keeps the delegation's reservation", () => {
  const first = capture(replay([said("user", "Fix the bug", 1_000)]), "del_1")
  expect(first.lines).toEqual(["user: Fix the bug"])

  const repeated = transitionTranscriptTail(first.state, captured("del_1"))
  expect(repeated).toBe(first.state)
  expect(capturedLines(repeated, "del_1")).toEqual(["user: Fix the bug"])
  // The words stay reserved, so an overlapping delegation does not take them.
  const overlap = capture(repeated, "del_2")
  expect(overlap.lines).toEqual([])

  const done = replay([accepted("del_1")], overlap.state)
  expect(done.entries[0]?.delivery).toEqual({ status: "sent", revision: 1 })
  expect(capture(done, "del_3").lines).toEqual([])
})

test("blank deltas start no utterance and do not mark the next one as updated", () => {
  const start = createTranscriptTailState()
  const blank = replay([said("user", "", 1_000), said("user", "   ", 1_100)], start)
  expect(blank).toBe(start)
  expect(blank.entries.at(-1)).toBeUndefined()
  expect(transcriptLines(blank)).toBe("")

  const empty = capture(blank, "del_1")
  expect(empty.lines).toEqual([])
  const spoken = replay([released("del_1"), said("user", "Hello", 1_200)], empty.state)
  expect(capture(spoken, "del_2").lines).toEqual(["user: Hello"])
})

test("trailing spacing on a sent utterance does not send it again", () => {
  const sent = replay([said("user", "Hello", 1_000), captured("del_1"), accepted("del_1")])
  const spaced = transitionTranscriptTail(sent, said("user", " ", 1_200))
  expect(spaced.entries[0]?.text).toBe("Hello ")
  expect(spaced.entries[0]?.delivery).toEqual({ status: "sent", revision: 1 })
  expect(capture(spaced, "del_2").lines).toEqual([])

  const worded = transitionTranscriptTail(spaced, said("user", "world", 1_400))
  expect(worded.entries[0]?.delivery).toEqual({ status: "revised", revision: 2, sent: 1 })
  expect(capture(worded, "del_3").lines).toEqual(["user (updated utterance): Hello world"])
})

test("an empty delta does not extend the merge window", () => {
  const state = replay([said("user", "Hello", 1_000), said("user", "", 2_000)])
  expect(state.entries[0]?.at).toBe(1_000)
  expect(transitionTranscriptTail(state, said("user", "Again", 2_600)).entries).toHaveLength(2)
})

test("clearing reservations offers their words to the next delegation", () => {
  const reserved = replay([
    said("user", "Open the session", 1_000),
    captured("del_1"),
    said("assistant", "Opening it", 3_000),
    captured("del_2"),
  ])

  expect(capture(reserved, "del_3").lines).toEqual([])

  const cleared = transitionTranscriptTail(reserved, { type: "reservations.cleared" })
  expect(cleared.reservations.size).toBe(0)
  expect(capture(cleared, "del_3").lines).toEqual(["user: Open the session", "assistant: Opening it"])
  expect(transitionTranscriptTail(cleared, { type: "reservations.cleared" })).toBe(cleared)
})

test("an unknown delegation changes nothing", () => {
  const state = replay([said("user", "Hello", 1_000), captured("del_1")])
  expect(transitionTranscriptTail(state, accepted("del_x"))).toBe(state)
  expect(transitionTranscriptTail(state, released("del_x"))).toBe(state)
})

test("a role switch or a 1.5 s pause starts a new utterance", () => {
  const state = replay([
    said("user", "One", 1_000),
    said("assistant", "Two", 1_100),
    said("assistant", " more", 2_599),
    said("assistant", "Three", 4_099),
  ])

  expect(state.entries.map((entry) => entry.text)).toEqual(["One", "Two more", "Three"])
})

test("the transcript keeps the newest utterances", () => {
  const state = replay(
    Array.from({ length: MAX_UTTERANCES + 2 }, (_, index) => said("user", `Line ${index}`, index * 2_000)),
  )

  expect(state.entries).toHaveLength(MAX_UTTERANCES)
  expect(state.entries[0]?.text).toBe("Line 2")
  expect(state.nextID).toBe(MAX_UTTERANCES + 2)
})
