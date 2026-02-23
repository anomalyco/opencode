import { describe, expect, test } from "bun:test"
import { isSteerKey, isSubmitRequestSuccess, routeSubmit } from "../../../src/cli/cmd/tui/component/prompt/submit-routing"

describe("tui prompt submit routing", () => {
  test("routes busy default submit to normal prompt", () => {
    expect(
      routeSubmit({
        busy: true,
        intent: "default",
        hasNonText: true,
      }),
    ).toBe("prompt")
  })

  test("routes busy steer submit to steer when text only", () => {
    expect(
      routeSubmit({
        busy: true,
        intent: "steer",
        hasNonText: false,
      }),
    ).toBe("steer")
  })

  test("rejects busy steer submit when non-text parts are present", () => {
    expect(
      routeSubmit({
        busy: true,
        intent: "steer",
        hasNonText: true,
      }),
    ).toBe("reject-steer-nontext")
  })

  test("routes idle default submit to normal prompt", () => {
    expect(
      routeSubmit({
        busy: false,
        intent: "default",
        hasNonText: false,
      }),
    ).toBe("prompt")
  })
})

describe("tui prompt steer shortcut", () => {
  test("uses configured steer shortcut only when busy and in normal mode", () => {
    expect(
      isSteerKey({
        busy: true,
        mode: "normal",
        matched: true,
      }),
    ).toBe(true)
  })

  test("does not steer when shortcut did not match", () => {
    expect(
      isSteerKey({
        busy: true,
        mode: "normal",
        matched: false,
      }),
    ).toBe(false)
  })

  test("does not steer when idle", () => {
    expect(
      isSteerKey({
        busy: false,
        mode: "normal",
        matched: true,
      }),
    ).toBe(false)
  })

  test("does not steer in shell mode", () => {
    expect(
      isSteerKey({
        busy: true,
        mode: "shell",
        matched: true,
      }),
    ).toBe(false)
  })
})

describe("tui prompt submit request success detection", () => {
  test("accepts data-style empty object (204 promptAsync)", () => {
    expect(isSubmitRequestSuccess({})).toBe(true)
  })

  test("accepts fields-style success result", () => {
    expect(
      isSubmitRequestSuccess({
        data: {},
        error: undefined,
        response: { ok: true },
      }),
    ).toBe(true)
  })

  test("rejects undefined result", () => {
    expect(isSubmitRequestSuccess(undefined)).toBe(false)
  })

  test("rejects null result", () => {
    expect(isSubmitRequestSuccess(null)).toBe(false)
  })

  test("rejects fields-style error result", () => {
    expect(
      isSubmitRequestSuccess({
        data: undefined,
        error: { message: "oops" },
        response: { ok: false },
      }),
    ).toBe(false)
  })

  test("rejects non-ok response without error", () => {
    expect(
      isSubmitRequestSuccess({
        data: {},
        error: undefined,
        response: { ok: false },
      }),
    ).toBe(false)
  })
})
