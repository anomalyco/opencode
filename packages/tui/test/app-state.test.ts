import { expect, test } from "bun:test"
import {
  createPasteSummaryEnabled,
  resolvePasteSummaryEnabled,
  resolveSkipInitialLoading,
  startupPromptReady,
} from "../src/app-state"

test("fast boot is default and OPENCODE_NO_FAST_BOOT restores the initial gate", () => {
  expect(resolveSkipInitialLoading(undefined)).toBe(true)
  expect(resolveSkipInitialLoading("1")).toBe(false)
})

test("paste summary follows config until the user stores an override", () => {
  expect(resolvePasteSummaryEnabled(undefined, true)).toBe(false)
  expect(resolvePasteSummaryEnabled(undefined, false)).toBe(true)
  expect(resolvePasteSummaryEnabled(false, false)).toBe(false)
  expect(resolvePasteSummaryEnabled(true, true)).toBe(true)
})

test("paste summary accessor follows late synchronized config without a stored override", () => {
  let disabledByConfig: boolean | undefined = false
  const enabled = createPasteSummaryEnabled(
    () => undefined,
    () => disabledByConfig,
  )

  expect(enabled()).toBe(true)
  disabledByConfig = true
  expect(enabled()).toBe(false)
})

test("paste summary accessor keeps an explicit stored override authoritative", () => {
  let stored: boolean | undefined = true
  let disabledByConfig: boolean | undefined = true
  const enabled = createPasteSummaryEnabled(
    () => stored,
    () => disabledByConfig,
  )

  expect(enabled()).toBe(true)
  disabledByConfig = false
  expect(enabled()).toBe(true)
  stored = false
  expect(enabled()).toBe(false)
})

test("startup prompt waits for actionable metadata before its only submit attempt", () => {
  expect(
    startupPromptReady({
      prompt: "hello",
      provider: "loading",
      agent: "complete",
      command: "complete",
      hasModel: true,
    }),
  ).toBe(false)
  expect(
    startupPromptReady({
      prompt: "hello",
      provider: "complete",
      agent: "complete",
      command: "complete",
      hasModel: false,
    }),
  ).toBe(false)
  expect(
    startupPromptReady({
      prompt: "/review",
      provider: "complete",
      agent: "complete",
      command: "loading",
      hasModel: true,
    }),
  ).toBe(false)
  expect(
    startupPromptReady({
      prompt: "hello",
      provider: "complete",
      agent: "complete",
      command: "loading",
      hasModel: true,
    }),
  ).toBe(true)
})
