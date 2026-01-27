#!/usr/bin/env bun

/**
 * TOON Test Runner
 * 
 * Runs all TOON-related tests and generates a summary report
 */

import { $ } from "bun"

console.log("🧪 Running TOON Test Suite\n")
console.log("=" .repeat(60))

const testFiles = [
  "test/toon.test.ts",
  "test/toon-metadata.test.ts",
  "test/toon-integration.test.ts",
  "test/toon-performance.test.ts",
  "test/toon-regression.test.ts",
]

let totalTests = 0
let passedTests = 0
let failedTests = 0

for (const testFile of testFiles) {
  console.log(`\n📝 Running ${testFile}...`)
  
  try {
    const result = await $`bun test ${testFile}`.quiet()
    
    // Parse output to count tests
    const output = result.stdout.toString()
    const matches = output.match(/(\d+) pass/)
    
    if (matches) {
      const passed = parseInt(matches[1])
      passedTests += passed
      totalTests += passed
      console.log(`✅ ${passed} tests passed`)
    }
  } catch (error: any) {
    console.log(`❌ Tests failed`)
    failedTests++
    
    // Show error details
    if (error.stderr) {
      console.log(error.stderr.toString())
    }
  }
}

console.log("\n" + "=".repeat(60))
console.log("\n📊 Test Summary:")
console.log(`   Total Tests: ${totalTests}`)
console.log(`   ✅ Passed: ${passedTests}`)
console.log(`   ❌ Failed: ${failedTests}`)

if (failedTests === 0) {
  console.log("\n🎉 All tests passed!")
  process.exit(0)
} else {
  console.log("\n⚠️  Some tests failed")
  process.exit(1)
}
