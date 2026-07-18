export type EventInterest = {
  readonly location?: {
    readonly directory: string
    readonly workspace?: string
  }
  readonly sessions?: ReadonlyArray<string>
}

export function interestEqual(left?: EventInterest, right?: EventInterest) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.location?.directory !== right.location?.directory) return false
  if (left.location?.workspace !== right.location?.workspace) return false
  const a = left.sessions ?? []
  const b = right.sessions ?? []
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Map TUI interest into the generated `event.subscribe` query shape. */
export function subscribeInput(interest?: EventInterest) {
  if (!interest) return undefined
  const location = interest.location
  const session = interest.sessions && interest.sessions.length > 0 ? [...interest.sessions] : undefined
  return {
    ...(location ? { location } : {}),
    ...(session ? { session } : {}),
  }
}
