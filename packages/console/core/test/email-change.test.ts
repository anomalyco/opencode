import { describe, expect, test } from "bun:test"
import { EmailChange } from "../src/email-change"

describe("EmailChange.nextConfirmationState", () => {
  const now = new Date("2026-05-06T12:00:00Z")
  const previous = new Date("2026-05-06T11:00:00Z")

  test("confirms old email token without completing", () => {
    const result = EmailChange.nextConfirmationState({
      oldTokenHash: "old",
      newTokenHash: "new",
      tokenHash: "old",
      oldConfirmedAt: null,
      newConfirmedAt: null,
      now,
    })

    expect(result.oldConfirmedAt).toBe(now)
    expect(result.newConfirmedAt).toBeNull()
    expect(result.complete).toBe(false)
  })

  test("confirms new email token without completing", () => {
    const result = EmailChange.nextConfirmationState({
      oldTokenHash: "old",
      newTokenHash: "new",
      tokenHash: "new",
      oldConfirmedAt: null,
      newConfirmedAt: null,
      now,
    })

    expect(result.oldConfirmedAt).toBeNull()
    expect(result.newConfirmedAt).toBe(now)
    expect(result.complete).toBe(false)
  })

  test("completes when old confirmation already exists and new token is confirmed", () => {
    const result = EmailChange.nextConfirmationState({
      oldTokenHash: "old",
      newTokenHash: "new",
      tokenHash: "new",
      oldConfirmedAt: previous,
      newConfirmedAt: null,
      now,
    })

    expect(result.oldConfirmedAt).toBe(previous)
    expect(result.newConfirmedAt).toBe(now)
    expect(result.complete).toBe(true)
  })

  test("completes when new confirmation already exists and old token is confirmed", () => {
    const result = EmailChange.nextConfirmationState({
      oldTokenHash: "old",
      newTokenHash: "new",
      tokenHash: "old",
      oldConfirmedAt: null,
      newConfirmedAt: previous,
      now,
    })

    expect(result.oldConfirmedAt).toBe(now)
    expect(result.newConfirmedAt).toBe(previous)
    expect(result.complete).toBe(true)
  })

  test("preserves existing confirmations", () => {
    const result = EmailChange.nextConfirmationState({
      oldTokenHash: "old",
      newTokenHash: "new",
      tokenHash: "other",
      oldConfirmedAt: previous,
      newConfirmedAt: now,
      now: new Date("2026-05-06T13:00:00Z"),
    })

    expect(result.oldConfirmedAt).toBe(previous)
    expect(result.newConfirmedAt).toBe(now)
    expect(result.complete).toBe(true)
  })
})
