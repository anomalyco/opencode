import { nativeRule } from "../src/vm/runtime/objects.js"

// Every test run checks that natives are made only with the intrinsics.
nativeRule.check = true
