import { describe, expect, test } from "bun:test"
import { createSteerBackground } from "./steer-background"

function setup(input: { fail?: boolean } = {}) {
  const moves: string[] = []
  const state = { sessionID: "ses_alpha", blocking: [{ partID: "prt_shell" }] }

  const claim = createSteerBackground({
    sessionID: () => state.sessionID,
    blocking: () => state.blocking,
    move: async (sessionID) => {
      moves.push(sessionID)

      if (input.fail) throw new Error("server unavailable")
    },
  })

  return { claim, moves, state }
}

describe("createSteerBackground", () => {
  test("claims each blocking work item once while its move is in flight", async () => {
    const { claim, moves, state } = setup()

    const first = claim("ses_alpha")
    expect(claim("ses_alpha")).toBeUndefined()

    state.blocking = [{ partID: "prt_shell" }, { partID: "prt_subagent" }]
    await Promise.all([first?.move(), claim("ses_alpha")?.move()])
    expect(moves).toEqual(["ses_alpha", "ses_alpha"])
  })

  // The server moves only work that already blocks the run: a call that starts its shell or subagent just after the
  // move still blocks, and the next steer must move it.
  test("work still blocking after a move is moved by the next steer", async () => {
    const { claim, moves } = setup()

    await claim("ses_alpha")?.move()
    await claim("ses_alpha")?.move()
    expect(moves).toEqual(["ses_alpha", "ses_alpha"])
  })

  test("claims nothing without blocking work or for another session", () => {
    const { claim, state } = setup()

    expect(claim("ses_beta")).toBeUndefined()
    state.blocking = []
    expect(claim("ses_alpha")).toBeUndefined()
  })

  test("a released claim or failed move lets a later steer move the work", async () => {
    const released = setup()

    released.claim("ses_alpha")?.release()
    expect(released.claim("ses_alpha")).toBeDefined()

    const failed = setup({ fail: true })

    await failed.claim("ses_alpha")?.move()
    await failed.claim("ses_alpha")?.move()
    expect(failed.moves).toEqual(["ses_alpha", "ses_alpha"])
  })
})
