/**
 * A steer moves the run's blocking shells and subagents to the background, so the agent reads it at its next step.
 * Each work item is claimed while its move is in flight, so concurrent steers move it once. The claim ends with the
 * move: the server moves only work whose job already blocks the run, so a call that started its shell or subagent
 * just after the move still blocks, and a later steer or the inline hint must be able to move it.
 */
export function createSteerBackground(input: {
  sessionID: () => string | undefined
  blocking: () => readonly { partID: string }[]
  move: (sessionID: string) => Promise<void>
}) {
  const moving = new Set<string>()

  return (sessionID: string) => {
    if (input.sessionID() !== sessionID) return
    const parts = input.blocking().flatMap((task) => (moving.has(task.partID) ? [] : [task.partID]))

    if (parts.length === 0) return
    parts.forEach((id) => moving.add(id))
    const release = () => parts.forEach((id) => moving.delete(id))

    return {
      release,
      move: () => input.move(sessionID).then(release, release),
    }
  }
}
