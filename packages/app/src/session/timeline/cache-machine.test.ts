import { expect, test } from "bun:test"
import {
  createTimelineCacheEntryState,
  transitionTimelineCacheEntry,
  type TimelineCacheEntryEvent,
} from "./cache-machine"

const synced = (selected: boolean, hasTranscript: boolean): TimelineCacheEntryEvent => ({
  type: "synced",
  selected,
  hasTranscript,
})

test.each([
  {
    // The old edge-triggered check only saw the transcript empty out, never the view detaching afterwards.
    name: "a transcript evicted while selected evicts the view once it detaches",
    events: [synced(true, false), synced(false, false)],
    status: "evicted",
  },
  {
    name: "a transcript evicted while detached evicts the view",
    events: [synced(false, true), synced(false, false)],
    status: "evicted",
  },
  {
    name: "a session that never had a transcript keeps its view",
    events: [synced(false, false)],
    status: "detached",
    hasTranscript: false,
  },
  {
    name: "an evicted view stays evicted when its session is selected again",
    events: [synced(false, false), synced(true, true)],
    status: "evicted",
  },
])("$name", ({ events, status, hasTranscript = true }) => {
  const state = events.reduce(
    transitionTimelineCacheEntry,
    createTimelineCacheEntryState({ selected: true, hasTranscript }),
  )

  expect(state.status).toBe(status)
})

test("a steady sync returns the same state", () => {
  const state = createTimelineCacheEntryState({ selected: false, hasTranscript: true })

  expect(transitionTimelineCacheEntry(state, synced(false, true))).toBe(state)
})
