type Speed = { readonly id: string; readonly faster: boolean }

/** A model's speeds in order: the slower ones, its standard speed (no name), then the faster ones. */
export function orderedSpeeds(speeds: readonly Speed[]): (string | undefined)[] {
  return [
    ...speeds.flatMap((speed) => (speed.faster ? [] : [speed.id])),
    undefined,
    ...speeds.flatMap((speed) => (speed.faster ? [speed.id] : [])),
  ]
}

/** The speed after `current`, wrapping from the fastest back to the slowest. */
export function cycleModelSpeed(current: string | undefined, speeds: readonly Speed[]) {
  const order = orderedSpeeds(speeds)

  return order[(order.indexOf(current) + 1) % order.length]
}
