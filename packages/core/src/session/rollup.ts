export * as SessionRollup from "./rollup"

/**
 * Minimal structural view of a session accepted by `rollup` — satisfied by
 * the V2 `SessionSchema.Info`, the legacy `Session.Info`, and TUI session
 * objects.
 */
export type Source = {
  readonly id: string
  readonly parentID?: string | undefined
  readonly cost?: number | undefined
  readonly tokens?:
    | {
        readonly input?: number
        readonly output?: number
        readonly reasoning?: number
        readonly cache?: { readonly read?: number; readonly write?: number }
      }
    | undefined
}

type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
type Usage = { cost: number; tokens: Tokens }
type Rollup = { cost: number; tokens: Tokens; subagents: Usage }

const zeroTokens = (): Tokens => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

const addTokens = (left: Tokens, right?: Source["tokens"]): Tokens => ({
  input: left.input + (right?.input ?? 0),
  output: left.output + (right?.output ?? 0),
  reasoning: left.reasoning + (right?.reasoning ?? 0),
  cache: {
    read: left.cache.read + (right?.cache?.read ?? 0),
    write: left.cache.write + (right?.cache?.write ?? 0),
  },
})

const addUsage = (left: Usage, session: Source): Usage => ({
  cost: left.cost + (session.cost ?? 0),
  tokens: addTokens(left.tokens, session.tokens),
})

const zero = (): Usage => ({ cost: 0, tokens: zeroTokens() })

/**
 * Total usage for `rootID` across itself and all descendant sessions. Every
 * descendant contributes to `subagents`; `cost`/`tokens` are the inclusive
 * totals. The visited set guards against `parent_id` cycles in hand-edited data.
 */
export const rollup = (sessions: ReadonlyArray<Source>, rootID: string): Rollup => {
  const byParent = new Map<string, Source[]>()
  for (const session of sessions) {
    if (session.parentID === undefined) continue
    byParent.set(session.parentID, [...(byParent.get(session.parentID) ?? []), session])
  }
  const self = zero()
  const subagents = zero()
  const root = sessions.find((session) => session.id === rootID)
  if (root) Object.assign(self, addUsage(self, root))
  const visited = new Set<string>([rootID])
  const walk = (parentID: string) => {
    for (const child of byParent.get(parentID) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      Object.assign(subagents, addUsage(subagents, child))
      walk(child.id)
    }
  }
  walk(rootID)
  return {
    cost: self.cost + subagents.cost,
    tokens: addTokens(self.tokens, subagents.tokens),
    subagents: { cost: subagents.cost, tokens: subagents.tokens },
  }
}