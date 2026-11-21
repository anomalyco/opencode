import { describe, expect, test } from "bun:test"
import { instanceId, isWorkflowError, recentInstanceIds, skipReason } from "./schedule"

describe("data sync schedule", () => {
  test("names one instance per hourly slot and per history day", () => {
    const at = new Date("2026-11-03T03:20:00.000Z")

    expect(instanceId(at, false)).toBe("data-hourly-2026-11-03T03")
    expect(instanceId(at, true)).toBe("data-history-2026-11-03")
    expect(instanceId(new Date("2026-11-03T03:05:59.999Z"), false)).toBe("data-hourly-2026-11-03T03")
  })

  test("probes this hour and the previous five for an hourly run", () => {
    expect(recentInstanceIds(new Date("2026-11-01T02:05:00.000Z"), false)).toEqual([
      "data-hourly-2026-11-01T02",
      "data-hourly-2026-11-01T01",
      "data-hourly-2026-11-01T00",
      "data-hourly-2026-10-31T23",
      "data-hourly-2026-10-31T22",
      "data-hourly-2026-10-31T21",
    ])
  })

  test("probes today and the previous two days for a history run", () => {
    expect(recentInstanceIds(new Date("2026-11-01T03:20:00.000Z"), true)).toEqual([
      "data-history-2026-11-01",
      "data-history-2026-10-31",
      "data-history-2026-10-30",
    ])
  })

  test("lets hourly and history runs overlap", () => {
    const at = new Date("2026-11-03T04:05:00.000Z")
    const running = new Set(["data-history-2026-11-03", "data-hourly-2026-11-03T03"])
    const decide = (history: boolean) =>
      skipReason(
        instanceId(at, history),
        recentInstanceIds(at, history).map((id) => ({ id, status: running.has(id) ? "running" : undefined })),
      )

    expect(decide(false)).toEqual({
      reason: "previous run active",
      instance: "data-hourly-2026-11-03T03",
      status: "running",
    })
    running.delete("data-hourly-2026-11-03T03")
    expect(decide(false)).toBeUndefined()
    expect(decide(true)).toEqual({ reason: "already created", instance: "data-history-2026-11-03", status: "running" })
    running.delete("data-history-2026-11-03")
    running.add("data-hourly-2026-11-03T04")
    expect(decide(true)).toBeUndefined()
  })

  test("starts when no recent instance is active", () => {
    expect(
      skipReason("data-hourly-2026-11-03T04", [
        { id: "data-hourly-2026-11-03T04", status: undefined },
        { id: "data-hourly-2026-11-03T03", status: "complete" },
        { id: "data-hourly-2026-11-03T02", status: "errored" },
        { id: "data-hourly-2026-11-03T01", status: "terminated" },
      ]),
    ).toBeUndefined()
  })

  test.each(["queued", "running", "waiting", "paused", "waitingForPause"])(
    "skips while a previous run is %s",
    (status) => {
      expect(
        skipReason("data-hourly-2026-11-03T04", [
          { id: "data-hourly-2026-11-03T04", status: undefined },
          { id: "data-hourly-2026-11-03T03", status },
        ]),
      ).toEqual({ reason: "previous run active", instance: "data-hourly-2026-11-03T03", status })
    },
  )

  test("skips a slot that already has an instance in any state", () => {
    expect(skipReason("data-history-2026-11-03", [{ id: "data-history-2026-11-03", status: "complete" }])).toEqual({
      reason: "already created",
      instance: "data-history-2026-11-03",
      status: "complete",
    })
  })

  test("recognizes Workflow binding errors by their code only", () => {
    expect(isWorkflowError(new Error("instance.not_found"), "instance.not_found")).toBe(true)
    expect(isWorkflowError(new Error("(instance.not_found) Instance does not exist"), "instance.not_found")).toBe(true)
    expect(
      isWorkflowError(new Error("(instance.already_exists) Instance already exists"), "instance.already_exists"),
    ).toBe(true)
    expect(isWorkflowError(new Error("internal error"), "instance.not_found")).toBe(false)
    expect(isWorkflowError(new Error("(instance.already_exists) Instance already exists"), "instance.not_found")).toBe(
      false,
    )
    expect(isWorkflowError("instance.not_found", "instance.not_found")).toBe(false)
  })
})
