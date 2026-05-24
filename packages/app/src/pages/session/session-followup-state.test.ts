import { describe, expect, test } from "bun:test"
import { shouldAutoSendFollowup, shouldQueueFollowup } from "./session-followup-state"

describe("shouldQueueFollowup", () => {
  test("queues only when queue mode is enabled for a busy root session", () => {
    expect(
      shouldQueueFollowup({
        followup: "queue",
        busy: true,
        blocked: false,
        child: false,
      }),
    ).toBe(true)
  })

  test("does not queue when follow-up behavior is steer", () => {
    expect(
      shouldQueueFollowup({
        followup: "steer",
        busy: true,
        blocked: false,
        child: false,
      }),
    ).toBe(false)
  })

  test("does not queue while the session is idle, blocked, or a child", () => {
    expect(
      shouldQueueFollowup({
        followup: "queue",
        busy: false,
        blocked: false,
        child: false,
      }),
    ).toBe(false)
    expect(
      shouldQueueFollowup({
        followup: "queue",
        busy: true,
        blocked: true,
        child: false,
      }),
    ).toBe(false)
    expect(
      shouldQueueFollowup({
        followup: "queue",
        busy: true,
        blocked: false,
        child: true,
      }),
    ).toBe(false)
  })
})

describe("shouldAutoSendFollowup", () => {
  test("auto-sends only when the head item is ready to run", () => {
    expect(
      shouldAutoSendFollowup({
        hasItem: true,
        sending: false,
        failed: false,
        paused: false,
        blocked: false,
        busy: false,
        child: false,
      }),
    ).toBe(true)
  })

  test("does not auto-send when any blocking state is active", () => {
    expect(
      shouldAutoSendFollowup({
        hasItem: false,
        sending: false,
        failed: false,
        paused: false,
        blocked: false,
        busy: false,
        child: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        hasItem: true,
        sending: true,
        failed: false,
        paused: false,
        blocked: false,
        busy: false,
        child: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        hasItem: true,
        sending: false,
        failed: true,
        paused: false,
        blocked: false,
        busy: false,
        child: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        hasItem: true,
        sending: false,
        failed: false,
        paused: true,
        blocked: false,
        busy: false,
        child: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        hasItem: true,
        sending: false,
        failed: false,
        paused: false,
        blocked: true,
        busy: false,
        child: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        hasItem: true,
        sending: false,
        failed: false,
        paused: false,
        blocked: false,
        busy: true,
        child: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoSendFollowup({
        hasItem: true,
        sending: false,
        failed: false,
        paused: false,
        blocked: false,
        busy: false,
        child: true,
      }),
    ).toBe(false)
  })
})
