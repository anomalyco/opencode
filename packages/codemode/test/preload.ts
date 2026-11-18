import { setRoundTrip } from "../src/language/runtime/execute.js"
import { nativeRule } from "../src/language/runtime/objects.js"

// Every test run checks that natives are made only with the intrinsics.
nativeRule.check = true

if (process.env.CODEMODE_ROUNDTRIP === "1") {
  setRoundTrip(true)
}
