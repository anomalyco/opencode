import { describe, expect, test } from "bun:test"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunner } from "@opencode/core/session/runner/index"

const prompt = (name: string, delivery: SessionInbox.Delivery) =>
  ({ id: SessionMessage.ID.make(`msg_${name}`), type: "user", delivery }) as const
const synthetic = (name: string, delivery: SessionInbox.Delivery) =>
  ({ id: SessionMessage.ID.make(`msg_${name}`), type: "synthetic", delivery }) as const
const compaction = (name: string, delivery: SessionInbox.Delivery) =>
  ({ id: SessionMessage.ID.make(`msg_${name}`), type: "compaction", delivery }) as const
const move = (name: string, delivery: SessionInbox.Delivery) =>
  ({
    id: SessionMessage.ID.make(`msg_${name}`),
    type: "move",
    delivery,
    payload: { location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }), projectID: Project.ID.global },
  }) as const

const reaches = ["steer", "control", "input"] as const

describe("SessionInbox.plan", () => {
  test("nothing pending is empty at every reach", () => {
    for (const reach of reaches) expect(SessionInbox.plan([], reach)).toEqual({ _tag: "Empty" })
  })

  test("promotes every steered prompt together, at every reach", () => {
    const steers = [prompt("a", "steer"), synthetic("b", "steer")] as const
    for (const reach of reaches) expect(SessionInbox.plan(steers, reach)).toEqual({ _tag: "Promote", items: steers })
  })

  test("a steered compaction goes ahead of earlier steered prompts", () => {
    const pending = [prompt("a", "steer"), compaction("c", "steer"), prompt("b", "steer")]
    for (const reach of reaches)
      expect(SessionInbox.plan(pending, reach)).toEqual({ _tag: "Control", item: compaction("c", "steer") })
  })

  test("a steered compaction is never pulled across a steered move", () => {
    for (const reach of reaches) {
      expect(SessionInbox.plan([prompt("a", "steer"), move("m", "steer"), compaction("c", "steer")], reach)).toEqual({
        _tag: "Promote",
        items: [prompt("a", "steer")],
      })
      // A steered move at the head still owns a mid-turn boundary.
      expect(SessionInbox.plan([move("m", "steer"), compaction("c", "steer")], reach)).toEqual({
        _tag: "Control",
        item: move("m", "steer"),
      })
      // On its own side of the move, the compaction still goes ahead of earlier steers.
      expect(SessionInbox.plan([prompt("a", "steer"), compaction("c", "steer"), move("m", "steer")], reach)).toEqual({
        _tag: "Control",
        item: compaction("c", "steer"),
      })
    }
  })

  test("steered prompts stop at a steered move", () => {
    const pending = [prompt("a", "steer"), prompt("b", "steer"), move("m", "steer"), prompt("d", "steer")]
    expect(SessionInbox.plan(pending, "steer")).toEqual({
      _tag: "Promote",
      items: [prompt("a", "steer"), prompt("b", "steer")],
    })
  })

  test("steers go ahead of earlier queued input", () => {
    const pending = [prompt("q", "queue"), compaction("qc", "queue"), prompt("s", "steer")]
    for (const reach of reaches)
      expect(SessionInbox.plan(pending, reach)).toEqual({ _tag: "Promote", items: [prompt("s", "steer")] })
    expect(SessionInbox.plan([prompt("q", "queue"), compaction("c", "steer")], "steer")).toEqual({
      _tag: "Control",
      item: compaction("c", "steer"),
    })
  })

  test("an input boundary promotes exactly one queued prompt", () => {
    const pending = [prompt("q1", "queue"), synthetic("q2", "queue")]
    expect(SessionInbox.plan(pending, "input")).toEqual({ _tag: "Promote", items: [prompt("q1", "queue")] })
  })

  test("queued prompts stay parked under steer and control reach", () => {
    const pending = [prompt("q1", "queue"), compaction("qc", "queue")]
    expect(SessionInbox.plan(pending, "steer")).toEqual({ _tag: "Parked" })
    // A control behind a queued prompt waits its turn.
    expect(SessionInbox.plan(pending, "control")).toEqual({ _tag: "Parked" })
  })

  test("a queued control at the queue head needs control or input reach", () => {
    for (const control of [compaction("qc", "queue"), move("qm", "queue")]) {
      const pending = [control, prompt("q", "queue")]
      expect(SessionInbox.plan(pending, "steer")).toEqual({ _tag: "Parked" })
      expect(SessionInbox.plan(pending, "control")).toEqual({ _tag: "Control", item: control })
      expect(SessionInbox.plan(pending, "input")).toEqual({ _tag: "Control", item: control })
    }
  })
})

describe("SessionRunner.reach", () => {
  test("follows position, entry and the drain's promotable input", () => {
    const fresh = { _tag: "Fresh", forced: false } as const
    const forced = { _tag: "Fresh", forced: true } as const
    const between = { _tag: "BetweenTurns" } as const
    const continuing = { _tag: "Continue", step: 2 } as const
    for (const at of [fresh, forced, between])
      for (const entering of [true, false]) {
        expect(SessionRunner.reach(at, entering, "input")).toBe("input")
        expect(SessionRunner.reach(at, entering, "steer")).toBe("control")
      }
    for (const promotable of ["input", "steer"] as const) {
      expect(SessionRunner.reach(continuing, true, promotable)).toBe("control")
      expect(SessionRunner.reach(continuing, false, promotable)).toBe("steer")
    }
  })
})
