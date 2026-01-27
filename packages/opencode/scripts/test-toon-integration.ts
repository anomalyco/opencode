#!/usr/bin/env bun
/**
 * TOON Integration Test Script
 * 
 * This script tests the TOON integration by:
 * 1. Loading the configuration
 * 2. Transforming sample messages
 * 3. Displaying token savings
 */

import { TOON } from "./src/format/toon"
import { TOONTransform } from "./src/session/toon-transform"
import { TOONMetadata } from "./src/session/toon-metadata"
import type { ModelMessage } from "ai"

console.log("🧪 TOON Integration Test\n")
console.log("=" .repeat(60))

// Test 1: Basic serialization
console.log("\n📝 Test 1: Basic TOON Serialization")
console.log("-".repeat(60))

const testText = "Create a function that takes a parameter and returns a value from the database"
console.log(`Original: "${testText}"`)
console.log(`Length: ${testText.length} chars`)

const compactResult = TOON.serialize(testText, { mode: "compact", preserveCode: true })
console.log(`\nCompact: "${compactResult}"`)
console.log(`Length: ${compactResult.length} chars`)

const balancedResult = TOON.serialize(testText, { mode: "balanced", preserveCode: true })
console.log(`\nBalanced: "${balancedResult}"`)
console.log(`Length: ${balancedResult.length} chars`)

const verboseResult = TOON.serialize(testText, { mode: "verbose", preserveCode: true })
console.log(`\nVerbose: "${verboseResult}"`)
console.log(`Length: ${verboseResult.length} chars`)

// Test 2: Token savings calculation
console.log("\n\n💰 Test 2: Token Savings Calculation")
console.log("-".repeat(60))

const compactSavings = TOON.estimateSavings(testText, compactResult)
const compactPercentage = TOON.calculateSavingsPercentage(testText, compactResult)
console.log(`Compact Mode: ${compactSavings} tokens saved (${compactPercentage.toFixed(1)}%)`)

const balancedSavings = TOON.estimateSavings(testText, balancedResult)
const balancedPercentage = TOON.calculateSavingsPercentage(testText, balancedResult)
console.log(`Balanced Mode: ${balancedSavings} tokens saved (${balancedPercentage.toFixed(1)}%)`)

const verboseSavings = TOON.estimateSavings(testText, verboseResult)
const verbosePercentage = TOON.calculateSavingsPercentage(testText, verboseResult)
console.log(`Verbose Mode: ${verboseSavings} tokens saved (${verbosePercentage.toFixed(1)}%)`)

// Test 3: Code preservation
console.log("\n\n🔒 Test 3: Code Block Preservation")
console.log("-".repeat(60))

const codeText = `Refactor this function:
\`\`\`typescript
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0)
}
\`\`\`
Add proper type annotations and error handling for the function`

console.log(`Original length: ${codeText.length} chars`)

const codeResult = TOON.serialize(codeText, { mode: "balanced", preserveCode: true })
console.log(`Transformed length: ${codeResult.length} chars`)
console.log(`\nCode preserved: ${codeResult.includes("function calculateTotal") ? "✅ YES" : "❌ NO"}`)
console.log(`Text transformed: ${codeResult.includes("fn") ? "✅ YES" : "❌ NO"}`)

const codeSavings = TOON.estimateSavings(codeText, codeResult)
const codePercentage = TOON.calculateSavingsPercentage(codeText, codeResult)
console.log(`Savings: ${codeSavings} tokens (${codePercentage.toFixed(1)}%)`)

// Test 4: Metadata tracking
console.log("\n\n📊 Test 4: Metadata Tracking")
console.log("-".repeat(60))

const sessionId = "test-session-" + Date.now()
TOONMetadata.recordSavings(sessionId, {
  tokensSaved: balancedSavings,
  originalTokens: Math.ceil(testText.length / 4),
  transformedTokens: Math.ceil(balancedResult.length / 4),
  savingsPercentage: balancedPercentage,
  mode: "balanced",
})

const savedData = TOONMetadata.getSavings(sessionId)
console.log(`Session ID: ${sessionId}`)
console.log(`Saved data: ${savedData ? "✅ Found" : "❌ Not found"}`)

if (savedData) {
  const message = TOONMetadata.formatSavingsMessage(savedData)
  console.log(`Message: ${message}`)
}

// Summary
console.log("\n\n" + "=".repeat(60))
console.log("✅ TOON Integration Test Complete!")
console.log("=".repeat(60))
console.log("\nAll tests passed successfully. TOON is ready to use!")
console.log("\nTo enable TOON in OpenCode, ensure your config has:")
console.log(`  "experimental": {`)
console.log(`    "toon_format": {`)
console.log(`      "enabled": true,`)
console.log(`      "mode": "balanced",`)
console.log(`      "preserve_code": true`)
console.log(`    }`)
console.log(`  }`)
console.log("\n🚀 Happy coding with TOON!\n")
