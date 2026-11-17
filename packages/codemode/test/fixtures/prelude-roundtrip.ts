// Runs prelude built-ins in the round-trip mode and prints the result and how many round trips were taken while a
// prelude frame was on the stack.
import { Effect } from "effect"
import { CodeMode } from "../../src/index.js"
import { CodeFlags } from "../../src/opcodes.js"
import { setRoundTrip } from "../../src/runtime/execute.js"
import { Vm } from "../../src/vm.js"

setRoundTrip(true)

let saved = 0
// `captureVm` compacts the VM first, and nothing else does: counting compactions counts saves.
const compact = Vm.prototype.compact
Vm.prototype.compact = function (this: Vm) {
  if (this.frames.some((frame) => (frame.code.flags & CodeFlags.INTERNAL) !== 0)) saved++
  return compact.call(this)
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
