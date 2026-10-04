import { expect, test } from "bun:test"
import { summarizeFirstNavigation } from "../timeline/first-navigation-metrics"

test("reports blank frames before first destination and stable paint", () => {
  expect(
    summarizeFirstNavigation([
      { observedAtMs: 16, source: true, destination: false, content: true },
      { observedAtMs: 32, source: false, destination: false, content: false },
      { observedAtMs: 48, source: false, destination: true, content: true },
      { observedAtMs: 64, source: false, destination: true, content: true },
      { observedAtMs: 80, source: false, destination: true, content: true },
    ]),
  ).toEqual({
    samples: 5,
    firstDestinationObservedMs: 48,
    stableDestinationObservedMs: 80,
    sourceSamples: 1,
    blankSamples: 1,
    unknownSamples: 0,
    destinationSamples: 3,
  })
})

test("does not report stability for interrupted destination frames", () => {
  expect(
    summarizeFirstNavigation([
      { observedAtMs: 16, source: false, destination: true, content: true },
      { observedAtMs: 32, source: false, destination: false, content: true },
      { observedAtMs: 48, source: false, destination: true, content: true },
    ]).stableDestinationObservedMs,
  ).toBeNull()
})
