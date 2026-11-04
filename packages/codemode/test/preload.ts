import { nativeRule } from "../src/interpreter/objects.js"

// Every test run checks that natives are made only with the intrinsics.
nativeRule.check = true
