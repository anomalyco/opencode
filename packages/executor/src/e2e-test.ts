#!/usr/bin/env bun
/**
 * End-to-End Test: Backend Bash Tool → Executor → Univer SDK
 *
 * This test simulates the actual flow:
 * 1. Backend receives a tool call
 * 2. Bash tool sends command to executor
 * 3. Executor runs command in isolated environment
 * 4. Univer SDK is available and functional
 *
 * Usage: bun run e2e-test.ts
 */

import { v4 as uuidv4 } from "uuid"

const EXECUTOR_URL = process.env.VERITLY_EXECUTOR_URL ?? "http://localhost:7777"

interface ToolCallResult {
  success: boolean
  output: string
  exitCode: number
  duration: number
  error?: string
}

/**
 * Simulates the backend bash tool calling the executor
 */
async function simulateToolCall(
  sessionId: string,
  command: string,
  description: string,
  timeout = 120000,
): Promise<ToolCallResult> {
  const start = Date.now()

  try {
    const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${sessionId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeout }),
    })

    if (!response.ok) {
      if (response.status === 404) {
        // VM not found - should recreate and retry
        // In real backend, this happens automatically with retry logic
        return {
          success: false,
          output: "",
          exitCode: -1,
          duration: Date.now() - start,
          error: "VM_NOT_FOUND - Session VM was cleaned up due to inactivity",
        }
      }

      const error = await response.text()
      return {
        success: false,
        output: "",
        exitCode: -1,
        duration: Date.now() - start,
        error: `HTTP ${response.status}: ${error}`,
      }
    }

    const result = await response.json()

    return {
      success: result.exitCode === 0,
      output: result.output,
      exitCode: result.exitCode,
      duration: Date.now() - start,
    }
  } catch (error: any) {
    return {
      success: false,
      output: "",
      exitCode: -1,
      duration: Date.now() - start,
      error: error.message,
    }
  }
}

async function runE2ETest() {
  console.log("=".repeat(70))
  console.log("End-to-End Test: Backend → Executor → Univer SDK")
  console.log("=".repeat(70))
  console.log(`Executor: ${EXECUTOR_URL}`)
  console.log("=".repeat(70) + "\n")

  const sessionId = `e2e-test-${uuidv4()}`
  let allPassed = true

  // Test 1: Simple command
  console.log("Test 1: Simple Bash Command")
  console.log("-".repeat(70))
  const test1 = await simulateToolCall(sessionId, "echo 'Hello from isolated environment!'", "Echo test")
  if (test1.success) {
    console.log("✓ Success")
    console.log(`  Output: ${test1.output.trim()}`)
    console.log(`  Duration: ${test1.duration}ms`)
  } else {
    console.log("✗ Failed")
    console.log(`  Error: ${test1.error}`)
    allPassed = false
  }
  console.log()

  // Test 2: Python with Univer SDK
  console.log("Test 2: Python with Univer SDK")
  console.log("-".repeat(70))
  const test2 = await simulateToolCall(
    sessionId,
    `python3 -c "
from veritly_univer_sdk import RangeRect, UniverSDK
import json

# Create a RangeRect
r = RangeRect(startRow=0, endRow=10, startColumn=0, endColumn=5)

# Check SDK can be instantiated
sdk = UniverSDK()

result = {
    'status': 'success',
    'range': {
        'startRow': r.startRow,
        'endRow': r.endRow,
        'startColumn': r.startColumn,
        'endColumn': r.endColumn
    },
    'sdk_url': sdk.url if hasattr(sdk, 'url') else 'default'
}

print(json.dumps(result, indent=2))
"`,
    "Univer SDK basic usage",
  )
  if (test2.success) {
    console.log("✓ Success")
    console.log(`  Output:`)
    console.log(
      test2.output
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    )
    console.log(`  Duration: ${test2.duration}ms`)
  } else {
    console.log("✗ Failed")
    console.log(`  Error: ${test2.error}`)
    console.log(`  Output: ${test2.output}`)
    allPassed = false
  }
  console.log()

  // Test 3: File operations in workspace
  console.log("Test 3: File Operations in Workspace")
  console.log("-".repeat(70))
  const test3 = await simulateToolCall(
    sessionId,
    `cd /workspace && \
     echo '{"data": [1, 2, 3, 4, 5]}' > data.json && \
     python3 -c "
import json
with open('/workspace/data.json', 'r') as f:
    data = json.load(f)
print(f'Read data: {data}')
print(f'Sum: {sum(data[\"data\"])}')
"`,
    "File read/write with Python",
  )
  if (test3.success) {
    console.log("✓ Success")
    console.log(`  Output: ${test3.output.trim()}`)
    console.log(`  Duration: ${test3.duration}ms`)
  } else {
    console.log("✗ Failed")
    console.log(`  Error: ${test3.error}`)
    allPassed = false
  }
  console.log()

  // Test 4: Multi-step workflow
  console.log("Test 4: Multi-step Workflow (Simulated Spreadsheet Task)")
  console.log("-".repeat(70))

  // Step 1: Create a data file
  const step1 = await simulateToolCall(
    sessionId,
    `python3 << 'EOF'
import json
from veritly_univer_sdk import RangeRect

# Simulate preparing data for a spreadsheet
data = {
    "sheet_name": "Sales Data",
    "rows": [
        ["Product", "Q1", "Q2", "Q3", "Q4"],
        ["Widget A", 100, 150, 200, 250],
        ["Widget B", 80, 120, 160, 200],
        ["Widget C", 60, 90, 120, 150],
    ]
}

# Calculate totals
for i, row in enumerate(data["rows"][1:], 1):
    row.append(sum(row[1:]))

# Define a range for the data
header_range = RangeRect(startRow=0, endRow=0, startColumn=0, endColumn=4)
data_range = RangeRect(startRow=1, endRow=3, startColumn=0, endColumn=5)

with open('/workspace/sales_data.json', 'w') as f:
    json.dump(data, f, indent=2)

print(f"Header range: {header_range}")
print(f"Data range: {data_range}")
print(f"Data prepared successfully")
EOF`,
    "Prepare spreadsheet data",
  )

  if (!step1.success) {
    console.log("✗ Step 1 failed")
    console.log(`  Error: ${step1.error}`)
    allPassed = false
  } else {
    console.log("  Step 1 ✓ - Data prepared")

    // Step 2: Read and process
    const step2 = await simulateToolCall(
      sessionId,
      `python3 << 'EOF'
import json

with open('/workspace/sales_data.json', 'r') as f:
    data = json.load(f)

print(f"Sheet: {data['sheet_name']}")
print(f"Headers: {data['rows'][0]}")
print(f"Total products: {len(data['rows']) - 1}")

# Calculate grand total
grand_total = sum(row[-1] for row in data['rows'][1:])
print(f"Grand Total: {grand_total}")
EOF`,
      "Process spreadsheet data",
    )

    if (!step2.success) {
      console.log("✗ Step 2 failed")
      console.log(`  Error: ${step2.error}`)
      allPassed = false
    } else {
      console.log("  Step 2 ✓ - Data processed")
      console.log(`  Output: ${step2.output.trim()}`)
    }
  }
  console.log()

  // Test 5: Error handling
  console.log("Test 5: Error Handling")
  console.log("-".repeat(70))
  const test5 = await simulateToolCall(sessionId, "python3 -c 'import nonexistent_module'", "Test error handling")
  if (!test5.success && test5.exitCode !== 0) {
    console.log("✓ Success (error properly caught)")
    console.log(`  Exit code: ${test5.exitCode}`)
    console.log(`  Error output contains 'ModuleNotFoundError': ${test5.output.includes("ModuleNotFoundError")}`)
  } else {
    console.log("✗ Failed - should have returned error")
    allPassed = false
  }
  console.log()

  // Test 6: Session persistence (files persist across calls)
  console.log("Test 6: Session Persistence")
  console.log("-".repeat(70))
  const test6 = await simulateToolCall(sessionId, "cat /workspace/sales_data.json | head -5", "Verify files persist")
  if (test6.success && test6.output.includes("Sales Data")) {
    console.log("✓ Success - Files persist across tool calls")
  } else {
    console.log("✗ Failed - Files should persist in same session")
    allPassed = false
  }
  console.log()

  // Cleanup
  console.log("Cleanup: Closing session")
  console.log("-".repeat(70))
  try {
    await fetch(`${EXECUTOR_URL}/v1/sessions/${sessionId}/close`, { method: "POST" })
    console.log("✓ Session closed\n")
  } catch {
    console.log("⚠ Session cleanup failed (non-critical)\n")
  }

  // Summary
  console.log("=".repeat(70))
  console.log("END-TO-END TEST SUMMARY")
  console.log("=".repeat(70))
  if (allPassed) {
    console.log("🎉 All E2E tests passed!")
    console.log("\nThe integration is working correctly:")
    console.log("  ✓ Backend can send commands to executor")
    console.log("  ✓ Executor runs commands in isolated environment")
    console.log("  ✓ Univer SDK is available and functional")
    console.log("  ✓ File operations work in workspace")
    console.log("  ✓ Session persistence works")
    console.log("  ✓ Error handling works")
  } else {
    console.log("❌ Some tests failed")
    process.exit(1)
  }
  console.log("=".repeat(70))
}

runE2ETest().catch((error) => {
  console.error("Test failed with error:", error)
  process.exit(1)
})
