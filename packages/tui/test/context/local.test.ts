import { expect, test } from "bun:test"
import { createAgentSessionCommitTracker, recentModels } from "../../src/context/local"

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: "provider",
    modelID: `model-${index}`,
  }))

  expect(recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
    { providerID: "provider", modelID: "model-5" },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})

test("tracks agent commits across prompt lifetimes and retries indeterminate state", () => {
  const tracker = createAgentSessionCommitTracker()
  const first = tracker.start("session", "build", "plan")
  expect(first).toBeDefined()
  first?.succeed()

  expect(tracker.start("session", "build", "plan")).toBeUndefined()
  const restored = tracker.start("session", "build", "build")
  expect(restored).toBeDefined()
  restored?.fail()

  expect(tracker.start("session", "build", "build")).toBeDefined()
})

test("keeps an early agent event conservative until its request settles", () => {
  const tracker = createAgentSessionCommitTracker()
  const commit = tracker.start("session", "build", "plan")
  tracker.observe("session")
  commit?.succeed()

  expect(tracker.start("session", "plan", "plan")).toBeUndefined()
})

test("does not let an older matching event resolve a newer indeterminate agent commit", () => {
  const tracker = createAgentSessionCommitTracker()
  tracker.start("session", "build", "plan")?.succeed()
  tracker.start("session", "build", "build")?.succeed()
  tracker.start("session", "build", "plan")?.fail()

  tracker.observe("session")

  expect(tracker.start("session", "plan", "plan")).toBeDefined()
})

test("does not correlate older repeated agent events with a newer settled commit", () => {
  const tracker = createAgentSessionCommitTracker()
  tracker.start("session", "build", "plan")?.succeed()
  tracker.start("session", "build", "build")?.succeed()
  tracker.start("session", "build", "plan")?.succeed()

  tracker.observe("session")
  tracker.observe("session")

  expect(tracker.start("session", "build", "build")).toBeDefined()
})
