import { afterEach, describe, expect, test } from "bun:test"
import {
  approvalDecision,
  isApproved,
  isSessionApproved,
  nextApprovedList,
  rememberSessionApproval,
  resetSessionApprovalForTest,
} from "./dialog-workflow-approval-helpers"

afterEach(() => resetSessionApprovalForTest())

describe("approvalDecision", () => {
  test("never always starts without asking", () => {
    expect(approvalDecision({ mode: "never", alreadyApproved: false })).toBe("start")
    expect(approvalDecision({ mode: "never", alreadyApproved: true })).toBe("start")
  })
  test("always asks every time regardless of consent", () => {
    expect(approvalDecision({ mode: "always", alreadyApproved: true })).toBe("ask")
    expect(approvalDecision({ mode: "always", alreadyApproved: false })).toBe("ask")
  })
  test("first-run asks until approved", () => {
    expect(approvalDecision({ mode: "first-run", alreadyApproved: false })).toBe("ask")
    expect(approvalDecision({ mode: "first-run", alreadyApproved: true })).toBe("start")
  })
  test("undefined mode defaults to first-run semantics", () => {
    expect(approvalDecision({ mode: undefined, alreadyApproved: false })).toBe("ask")
    expect(approvalDecision({ mode: undefined, alreadyApproved: true })).toBe("start")
  })
})

describe("session consent", () => {
  test("remembering a name flips isSessionApproved", () => {
    expect(isSessionApproved("deploy")).toBe(false)
    rememberSessionApproval("deploy")
    expect(isSessionApproved("deploy")).toBe(true)
  })
  test("isApproved ORs the persisted list and the session cache", () => {
    expect(isApproved("deploy", [])).toBe(false)
    expect(isApproved("deploy", ["deploy"])).toBe(true)
    rememberSessionApproval("deploy")
    expect(isApproved("deploy", [])).toBe(true)
  })
})

describe("nextApprovedList", () => {
  test("appends a new name", () => {
    expect(nextApprovedList("deploy", [])).toEqual(["deploy"])
    expect(nextApprovedList("deploy", ["other"])).toEqual(["other", "deploy"])
  })
  test("returns undefined when already present (no redundant write)", () => {
    expect(nextApprovedList("deploy", ["deploy"])).toBeUndefined()
  })
})
