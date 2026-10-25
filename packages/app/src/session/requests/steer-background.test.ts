import { describe, expect, test } from "bun:test"
import { createSteerBackground } from "./steer-background"

function setup(input: { fail?: boolean } = {}) {
  const moves: string[] = []
  const state = { sessionID: "ses_alpha", blocking: [{ partID: "prt_shell" }] }

  const steer = createSteerBackground({
    sessionID: () => state.sessionID,
    blocking: () => state.blocking,
    move: async (sessionID) => {
      moves.push(sessionID)

      if (input.fail) throw new Error("server unavailable")
    },
  })

  return { steer, moves, state }
}

describe("createSteerBackground", () => {
  test("reads the blocking work when the move runs, after admission", async () => {
    const { steer, moves, state } = setup()
    state.blocking = []
    const background = steer("ses_alpha")

    state.blocking = [{ partID: "prt_shell" }]
    await background?.move()
    expect(moves).toEqual(["ses_alpha"])

    state.blocking = []
    await steer("ses_alpha")?.move()
    expect(moves).toEqual(["ses_alpha"])
  })

  // The server moves only work that already blocks the run: a call that starts its shell or subagent just after the
  // move still blocks, and the next steer must move it.
  test("work still blocking after a move is moved by the next steer", async () => {
    const { steer, moves } = setup()

    await steer("ses_alpha")?.move()
    await steer("ses_alpha")?.move()
    expect(moves).toEqual(["ses_alpha", "ses_alpha"])
  })

  test("overlapping steers each move, so a failed move leaves nothing behind", async () => {
    const { steer, moves } = setup({ fail: true })
    const first = steer("ses_alpha")
    const second = steer("ses_alpha")

    await Promise.all([first?.move(), second?.move()])
    expect(moves).toEqual(["ses_alpha", "ses_alpha"])
  })

  test("moves nothing for another session, and keeps a switched-away steer to its own work", async () => {
    const { steer, moves, state } = setup()

    expect(steer("ses_beta")).toBeUndefined()

    const background = steer("ses_alpha")
    state.sessionID = "ses_beta"
    state.blocking = []
    await background?.move()
    expect(moves).toEqual(["ses_alpha"])
  })
})
