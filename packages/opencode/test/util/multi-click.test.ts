import { test, expect } from "bun:test"
import { createMultiClickDetector } from "../../src/cli/cmd/tui/util/multi-click"

test("multi-click detector detects double click", (done) => {
  let doubleClickTriggered = false
  let tripleClickTriggered = false

  const detector = createMultiClickDetector(
    () => {
      doubleClickTriggered = true
    },
    () => {
      tripleClickTriggered = true
    },
    100, // Short timeout for testing
  )

  // Simulate double click
  detector(10, 10)
  detector(12, 11) // Within tolerance and timeout

  // Should trigger double click
  expect(doubleClickTriggered).toBe(true)
  expect(tripleClickTriggered).toBe(false)

  done()
})

test("multi-click detector detects triple click", (done) => {
  let doubleClickTriggered = false
  let tripleClickTriggered = false

  const detector = createMultiClickDetector(
    () => {
      doubleClickTriggered = true
    },
    () => {
      tripleClickTriggered = true
    },
    100, // Short timeout for testing
  )

  // Simulate triple click
  detector(10, 10)
  detector(12, 11) // Within tolerance and timeout
  detector(11, 12) // Within tolerance and timeout

  // Should trigger triple click
  expect(tripleClickTriggered).toBe(true)

  done()
})

test("multi-click detector resets after timeout", (done) => {
  let doubleClickTriggered = false
  let tripleClickTriggered = false

  const detector = createMultiClickDetector(
    () => {
      doubleClickTriggered = true
    },
    () => {
      tripleClickTriggered = true
    },
    50, // Very short timeout for testing
  )

  // First click
  detector(10, 10)

  // Wait for timeout to pass
  setTimeout(() => {
    // Second click after timeout should start new sequence
    detector(15, 15)

    // Give it a moment to process
    setTimeout(() => {
      // Should not trigger double click since timeout passed
      expect(doubleClickTriggered).toBe(false)
      expect(tripleClickTriggered).toBe(false)

      done()
    }, 20)
  }, 100)
})

test("multi-click detector handles position tolerance", (done) => {
  let doubleClickTriggered = false
  let tripleClickTriggered = false

  const detector = createMultiClickDetector(
    () => {
      doubleClickTriggered = true
    },
    () => {
      tripleClickTriggered = true
    },
    100,
  )

  // Clicks too far apart should not count as multi-click
  detector(10, 10)
  detector(20, 20) // Outside tolerance

  // Should not trigger double click
  expect(doubleClickTriggered).toBe(false)
  expect(tripleClickTriggered).toBe(false)

  done()
})
