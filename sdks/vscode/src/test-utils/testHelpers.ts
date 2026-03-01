import { screenshot, ScreenshotHelper } from "./screenshot"

/**
 * TestState tracks the current test execution state.
 */
interface TestState {
  currentTestName: string | null
  hasFailed: boolean
}

/**
 * Global test state for tracking failures.
 */
const state: TestState = {
  currentTestName: null,
  hasFailed: false,
}

/**
 * Set the current test name.
 */
export function setCurrentTest(name: string): void {
  state.currentTestName = name
  state.hasFailed = false
}

/**
 * Mark the current test as failed.
 */
export function markAsFailed(): void {
  state.hasFailed = true
}

/**
 * Get the current test state.
 */
export function getTestState(): TestState {
  return { ...state }
}

/**
 * Reset the test state.
 */
export function resetTestState(): void {
  state.currentTestName = null
  state.hasFailed = false
}

/**
 * beforeEach hook that sets up screenshot tracking.
 *
 * @param testName - The name of the test being run
 */
export function beforeEachScreenshot(testName: string): void {
  setCurrentTest(testName)
}

/**
 * afterEach hook that captures screenshot on failure.
 *
 * @param error - Optional error from the test
 */
export async function afterEachScreenshot(error?: Error): Promise<void> {
  if (error && state.currentTestName) {
    markAsFailed()
    await screenshot.captureOnFailure(state.currentTestName, error)
  }
}

/**
 * Export the screenshot helper for direct use.
 */
export { screenshot, ScreenshotHelper }
