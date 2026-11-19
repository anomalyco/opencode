import { setRoundTrip } from "../src/language/runtime/execute.js"
import { accessorRule, nativeRule } from "../src/language/runtime/objects.js"

// Every test run checks that natives are made only with the intrinsics, and that no built-in reaches a program
// getter or setter it has no path for.
nativeRule.check = true
accessorRule.check = true

if (process.env.CODEMODE_ROUNDTRIP === "1") {
  setRoundTrip(true)
}
