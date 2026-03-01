import * as vscode from "vscode"
import { screenshot, ScreenshotHelper, waitForStableUI } from "./screenshot"

/**
 * TestState tracks the current test execution state.
 */
interface TestState {
  currentTestName: string | null
  hasFailed: boolean
}

/**
 * Error thrown when UI verification fails.
 */
export class UIVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UIVerificationError"
  }
}

/**
 * Verify that the chat panel is open and visible.
 * Uses VS Code: API to check panel visibility state.
 *
 * @param vscodeApi - The VS Code: API module
 * @throws {UIVerificationError} If chat panel is not visible
 */
export async function verifyChatPanelOpen(vscodeApi: typeof vscode): Promise<void> {
  const chatTabs = vscodeApi.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label.toLowerCase().includes("chat") || tab.label.toLowerCase().includes("copilot"))

  if (chatTabs.length === 0) {
    throw new UIVerificationError("Chat panel is not open - no chat tabs found")
  }

  const activeChatTab = chatTabs.find((tab) => tab.isActive)
  if (!activeChatTab) {
    throw new UIVerificationError("Chat panel is not active - found chat tab but it's not the active tab")
  }
}

/**
 * Verify that the output channel is visible.
 *
 * @param vscodeApi - The VS Code: API module
 * @param channelName - Optional specific channel name to verify
 * @throws {UIVerificationError} If output channel is not visible
 */
export async function verifyOutputChannelVisible(vscodeApi: typeof vscode, channelName?: string): Promise<void> {
  const outputTabs = vscodeApi.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label.toLowerCase().includes("output"))

  if (outputTabs.length === 0) {
    throw new UIVerificationError("Output panel is not visible - no output tabs found")
  }

  if (channelName) {
    const specificTab = outputTabs.find((tab) => tab.label.toLowerCase().includes(channelName.toLowerCase()))
    if (!specificTab) {
      throw new UIVerificationError(`Output channel "${channelName}" is not visible`)
    }
  }
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
 * Export the screenshot helper and UI wait utility for direct use.
 */
export { screenshot, ScreenshotHelper, waitForStableUI }

/**
 * Cleanup function for test suites. Call in after() hook.
 */
export function cleanup(): void {
  screenshot.cleanup()
}
