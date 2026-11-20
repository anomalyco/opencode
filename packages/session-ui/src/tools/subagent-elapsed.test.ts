import { describe, expect, test } from "bun:test"
import { subagentElapsedTime } from "./subagent-elapsed"

const begin = 10_000

describe("subagentElapsedTime", () => {
  test("ticks from the call start while the child runs", () => {
    expect(subagentElapsedTime({ begin, running: true, childIdle: undefined, settledAt: undefined })).toEqual({
      created: begin,
      ran: begin,
    })
  })

  test("freezes a background dispatch at the child session's idle, not the call's launch completion", () => {
    expect(
      subagentElapsedTime({
        begin,
        running: false,
        childIdle: begin + 40_000,
        settledAt: undefined,
      }),
    ).toEqual({ created: begin, ran: begin, completed: begin + 40_000 })
  })

  test("keeps the idle transition the row saw when the child is continued later", () => {
    expect(
      subagentElapsedTime({
        begin,
        running: false,
        childIdle: begin + 900_000,
        settledAt: begin + 40_000,
      }),
    ).toEqual({ created: begin, ran: begin, completed: begin + 40_000 })
  })

  test("reports no time when nothing settled after the start instead of counting from the render clock", () => {
    expect(subagentElapsedTime({ begin, running: false, childIdle: undefined, settledAt: undefined })).toEqual({
      created: begin,
      ran: begin,
    })
    expect(subagentElapsedTime({ begin, running: false, childIdle: begin, settledAt: undefined })).toEqual({
      created: begin,
      ran: begin,
    })
  })

  test("has no time before the call starts", () => {
    expect(
      subagentElapsedTime({ begin: undefined, running: false, childIdle: begin + 1, settledAt: begin + 2 }),
    ).toBeUndefined()
  })
})
