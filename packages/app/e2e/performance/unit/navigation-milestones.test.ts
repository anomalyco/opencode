import { expect, test } from "bun:test"
import { summarizeNavigationMilestones } from "../timeline/navigation-milestones"

test("reports first and stable paint for each navigation milestone", () => {
  expect(
    summarizeNavigationMilestones([
      { observedAtMs: 16, milestones: { content: false, tab: false } },
      { observedAtMs: 32, milestones: { content: true, tab: false } },
      { observedAtMs: 48, milestones: { content: true, tab: true } },
      { observedAtMs: 64, milestones: { content: true, tab: true } },
      { observedAtMs: 80, milestones: { content: true, tab: true } },
    ]),
  ).toEqual({
    samples: 5,
    milestones: {
      content: { firstObservedMs: 32, stableObservedMs: 64 },
      tab: { firstObservedMs: 48, stableObservedMs: 80 },
    },
    all: { firstObservedMs: 48, stableObservedMs: 80 },
  })
})

test("reports missing stability when a milestone appears in the final samples", () => {
  expect(
    summarizeNavigationMilestones([
      { observedAtMs: 16, milestones: { content: false } },
      { observedAtMs: 32, milestones: { content: true } },
    ]),
  ).toEqual({
    samples: 2,
    milestones: { content: { firstObservedMs: 32, stableObservedMs: null } },
    all: { firstObservedMs: 32, stableObservedMs: null },
  })
})
