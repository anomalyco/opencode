/**
 * A background subagent returns as soon as it dispatches, so its call's own `completed` is a few milliseconds after
 * `begin` and would freeze the row at ~0s. The run's end belongs to the child session: `idle` records the end of its
 * latest execution and does not move for a rename, an archive, or a later turn that is not a run, while the idle
 * transition this row observed pins the run it dispatched even if the child is continued later.
 * Nothing here reads the render clock at mount: a row opened after the child finished shows the run's duration, and a
 * child with no recorded end shows no time rather than the time since launch.
 */
export function subagentElapsedTime(input: {
  begin: number | undefined
  running: boolean
  /** The child session's recorded end of its latest execution. */
  childIdle: number | undefined
  /** The moment this row saw the child go idle, when it was mounted for that transition. */
  settledAt: number | undefined
}) {
  const begin = input.begin

  if (begin === undefined) return undefined

  if (input.running) return { created: begin, ran: begin }

  // The earliest end after the start is this run's own: a later continuation only moves `idle` forwards.
  const ends = [input.settledAt, input.childIdle].flatMap((end) =>
    end === undefined || end <= begin ? [] : [end],
  )

  // Neither the child nor its observed transition settled after the start, so report no time rather than 0s.
  if (ends.length === 0) return { created: begin, ran: begin }

  return { created: begin, ran: begin, completed: Math.min(...ends) }
}
