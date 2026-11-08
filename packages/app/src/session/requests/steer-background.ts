/**
 * A steer moves the run's blocking shells and subagents to the background, so the agent reads it at its next step.
 * The move reads the blocking work once the steer is admitted, so work that started during admission moves too.
 * Nothing is claimed: the server moves each job once and ignores repeated moves, so overlapping steers, a failed
 * move, or one that ran before a job started never leave work for a later steer to skip.
 */
export function createSteerBackground(input: {
  sessionID: () => string | undefined
  blocking: () => readonly { partID: string }[]
  move: (sessionID: string) => Promise<void>
}) {
  return (sessionID: string) => {
    if (input.sessionID() !== sessionID) return
    const initial = input.blocking()

    return {
      move: () => {
        // After a switch to another session, the blocking work shown is that session's.
        const blocking = input.sessionID() === sessionID ? input.blocking() : initial

        if (blocking.length === 0) return Promise.resolve()

        return input.move(sessionID).catch(() => undefined)
      },
    }
  }
}
