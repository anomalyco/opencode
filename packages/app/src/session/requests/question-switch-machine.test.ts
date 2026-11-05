import { describe, expect, test } from "bun:test"
import {
  FRAME_MOVING_EVENT,
  FRAME_RESTING_EVENT,
  IDLE_QUESTION_LOOP,
  MEASURING_QUESTION_LOOP,
  isSwitchSliding,
  selectSwitchGhost,
  transitionQuestionLoop,
  type QuestionLoopEvent,
  type QuestionLoopState,
} from "./question-switch-machine"

type Copy = { readonly name: string }

type State = QuestionLoopState<Copy, Copy>

type Event = QuestionLoopEvent<Copy, Copy>

const into: Copy = { name: "into" }

const ghost: Copy = { name: "ghost" }

const started: Event = { type: "switch.started", into, ghost }

function replay(events: Event[], from: State = IDLE_QUESTION_LOOP) {
  return events.reduce<State[]>((states, event) => {
    states.push(transitionQuestionLoop(states.at(-1) ?? from, event))

    return states
  }, [])
}

describe("transitionQuestionLoop", () => {
  test("holds a measure queued before a switch until the switch comes to rest", () => {
    const states = replay([
      { type: "measure.requested" },
      started,
      { type: "measure.completed" },
      { type: "frame", intoDone: true, ghostDone: true, moving: false },
    ])

    expect(states[0]).toBe(MEASURING_QUESTION_LOOP)
    expect(states[1]).toEqual({ phase: "running", measureDeferred: true, into, ghost })
    expect(states[2]).toBe(states[1])
    expect(states[3]).toBe(MEASURING_QUESTION_LOOP)
  })

  test("keeps a measure requested mid-switch when motion turns off", () => {
    const states = replay([started, { type: "measure.requested" }, { type: "still" }])

    expect(states[1]).toEqual({ phase: "running", measureDeferred: true, into, ghost })
    expect(states[2]).toBe(MEASURING_QUESTION_LOOP)
    expect(transitionQuestionLoop(replay([started])[0]!, { type: "still" })).toBe(IDLE_QUESTION_LOOP)
  })

  test("starts no frame job for a wake with nothing moving", () => {
    expect(transitionQuestionLoop(IDLE_QUESTION_LOOP, { type: "wake", moving: false })).toBe(MEASURING_QUESTION_LOOP)
    expect(transitionQuestionLoop(MEASURING_QUESTION_LOOP, { type: "wake", moving: false })).toBe(
      MEASURING_QUESTION_LOOP,
    )
    expect(transitionQuestionLoop(IDLE_QUESTION_LOOP, { type: "wake", moving: true })).toMatchObject({
      phase: "running",
      measureDeferred: false,
    })
    expect(transitionQuestionLoop(MEASURING_QUESTION_LOOP, { type: "wake", moving: true })).toMatchObject({
      phase: "running",
      measureDeferred: true,
    })
  })

  test("returns the same state for frames in which no copy finishes", () => {
    const running = replay([started])[0]!

    expect(transitionQuestionLoop(running, FRAME_MOVING_EVENT)).toBe(running)
    expect(transitionQuestionLoop(running, FRAME_RESTING_EVENT)).toBe(running)
    expect(transitionQuestionLoop(running, { type: "wake", moving: true })).toBe(running)
    expect(transitionQuestionLoop(running, { type: "measure.requested" })).not.toBe(running)
  })

  test("drops each copy as it finishes and measures once everything rests", () => {
    const states = replay([
      started,
      { type: "frame", intoDone: true, ghostDone: false, moving: true },
      { type: "frame", intoDone: false, ghostDone: true, moving: true },
      FRAME_RESTING_EVENT,
    ])

    expect(states[1]).toEqual({ phase: "running", measureDeferred: false, into: undefined, ghost })
    expect(isSwitchSliding(states[2]!)).toBe(false)
    expect(states[2]!.phase).toBe("running")
    expect(states[3]).toBe(MEASURING_QUESTION_LOOP)
  })

  test("replaces the copies when a key lands mid-switch, and drops them when the switch is cut", () => {
    const next: Event = { type: "switch.started", into: { name: "next" }, ghost }
    const states = replay([started, next, { type: "switch.dropped" }])

    expect(selectSwitchGhost(states[1]!)).toBe(ghost)
    expect(states[1]).not.toBe(states[0])
    expect(isSwitchSliding(states[2]!)).toBe(false)
    expect(states[2]!.phase).toBe("running")
  })

  test("returns to idle when disposed, so the driver removes the leaving copy", () => {
    const running = replay([started])[0]!

    expect(transitionQuestionLoop(running, { type: "disposed" })).toBe(IDLE_QUESTION_LOOP)
    expect(transitionQuestionLoop(MEASURING_QUESTION_LOOP, { type: "disposed" })).toBe(IDLE_QUESTION_LOOP)
    expect(
      transitionQuestionLoop(IDLE_QUESTION_LOOP, { type: "frame", intoDone: true, ghostDone: true, moving: false }),
    ).toBe(IDLE_QUESTION_LOOP)
  })
})
