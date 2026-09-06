import { Skill } from "@opencode-ai/schema/skill"
import { Effect, Option, Schema } from "effect"
import type { KV } from "../kv.js"

const Legacy = Schema.Struct({
  target: Schema.Struct({ kind: Schema.Literal("skill"), id: Schema.String }),
  state: Skill.Activation,
})

// Preserve toggles written by the original activation-only preferences implementation.
export const migrate = Effect.fn("Preferences.migrate")(function* (kv: KV.Interface) {
  let after: string | undefined
  do {
    const page = yield* kv.scan({ prefix: "preferences:activation:", after, limit: 1000 })
    for (const row of page.entries) {
      const entry = Schema.decodeUnknownOption(Legacy)(row.value)
      if (Option.isNone(entry)) continue
      const target = { kind: "skill.activation", id: entry.value.target.id }
      const key = `preferences:values:${JSON.stringify([target.kind, target.id])}`
      if ((yield* kv.get(key)) === undefined) yield* kv.set(key, { target, value: entry.value.state })
      yield* kv.remove(row.key)
    }
    after = page.next
  } while (after !== undefined)
})
