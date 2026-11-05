// Run with CODEMODE_ROUNDTRIP=1: runs prelude built-ins and prints the result and how many round trips were taken
// while a prelude frame was on the stack.
import { Effect } from "effect"
import { CodeMode } from "../../src/index.js"
import { inPrelude } from "../../src/interpreter/source.js"
import { stats } from "../../src/machine/task.js"

const roundTrip = stats.inspect!
let saved = 0
stats.inspect = (stack, task) => {
  roundTrip(stack, task)
  if (task.slice && stack.some((frame) => frame.node !== undefined && inPrelude(frame.node))) saved++
}
const result = await Effect.runPromise(
  CodeMode.execute({
    tools: {},
    code: `
      const groups = Object.groupBy([1, 2, 3, 4, 5, 6], (x) => (x % 2 ? "odd" : "even"))
      const union = new Set([1, 2, 3]).union({ size: 2, has: () => true, keys: () => [7, 8][Symbol.iterator]() })
      const parsed = JSON.parse('{"a":[1,2,{"b":3}]}', (k, v) => (typeof v === "number" ? v * 10 : v))
      return [groups, [...union], parsed, [1, 2, 3].values().reduce((a, b) => a + b)]`,
  }),
)
console.log(JSON.stringify({ result, saved }))
