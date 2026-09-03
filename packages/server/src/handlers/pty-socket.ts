import { Effect } from "effect"

export function runPtySocket<A, E, R, A2, E2, R2>(
  drain: Effect.Effect<A, E, R>,
  socket: Effect.Effect<A2, E2, R2>,
  detach: () => void,
) {
  return Effect.raceFirst(drain, socket).pipe(Effect.ensuring(Effect.sync(detach)))
}
