#!/usr/bin/env bun
/**
 * Integration Test for Firecracker Executor + Univer SDK
 *
 * Tests:
 * 1. Executor health check
 * 2. Basic bash command execution via executor
 * 3. Python availability in executor VM
 * 4. Univer SDK import test (if available)
 *
 * Usage: bun run integration-test.ts
 */

import { v4 as uuidv4 } from "uuid"

const EXECUTOR_URL = process.env.VERITLY_EXECUTOR_URL ?? "http://localhost:7777"

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
  details?: object
}

class TestRunner {
  private results: TestResult[] = []
  private sessionId: string

  constructor() {
    this.sessionId = `test-${uuidv4()}`
  }

  async runTest(name: string, fn: () => Promise<void>): Promise<void> {
    const start = Date.now()
    try {
      await fn()
      this.results.push({
        name,
        passed: true,
        duration: Date.now() - start,
      })
      console.log(`✓ ${name} (${Date.now() - start}ms)`)
    } catch (error: any) {
      this.results.push({
        name,
        passed: false,
        duration: Date.now() - start,
        error: error.message,
      })
      console.error(`✗ ${name} (${Date.now() - start}ms)`)
      console.error(`  Error: ${error.message}`)
    }
  }

  async testExecutorHealth() {
    await this.runTest("Executor Health Check", async () => {
      const response = await fetch(`${EXECUTOR_URL}/health`)
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`)
      }
      const data = await response.json()
      if (data.ok !== true || data.mode !== "firecracker") {
        throw new Error(`Executor not healthy: ${JSON.stringify(data)}`)
      }
      console.log(`  Mode: ${data.mode}, Sessions: ${data.activeSessions}`)
    })
  }

  async testBasicCommand() {
    await this.runTest("Basic Bash Command", async () => {
      const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "echo 'Hello from executor!'",
          timeout: 30000,
        }),
      })

      if (!response.ok) {
        throw new Error(`Command failed: ${response.status}`)
      }

      const result = await response.json()
      if (result.exitCode !== 0) {
        throw new Error(`Command exited with code ${result.exitCode}: ${result.output}`)
      }
      if (!result.output.includes("Hello from executor")) {
        throw new Error(`Unexpected output: ${result.output}`)
      }
      console.log(`  Output: ${result.output.trim()}`)
    })
  }

  async testWorkingDirectory() {
    await this.runTest("Working Directory Isolation", async () => {
      // Create a file
      const response1 = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "echo 'test data' > /workspace/test-file.txt && pwd",
          timeout: 30000,
        }),
      })

      const result1 = await response1.json()
      if (result1.exitCode !== 0) {
        throw new Error(`Failed to create file: ${result1.output}`)
      }
      console.log(`  Working dir: ${result1.output.trim()}`)

      // Read the file back
      const response2 = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "cat /workspace/test-file.txt",
          timeout: 30000,
        }),
      })

      const result2 = await response2.json()
      if (result2.exitCode !== 0) {
        throw new Error(`Failed to read file: ${result2.output}`)
      }
      if (!result2.output.includes("test data")) {
        throw new Error(`File content mismatch: ${result2.output}`)
      }
    })
  }

  async testPythonAvailability() {
    await this.runTest("Python Availability", async () => {
      const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "python3 --version && which python3",
          timeout: 30000,
        }),
      })

      const result = await response.json()
      if (result.exitCode !== 0) {
        throw new Error(`Python check failed: ${result.output}`)
      }
      console.log(`  ${result.output.trim()}`)
    })
  }

  async testPipPackages() {
    await this.runTest("Pip Package List", async () => {
      const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "pip3 list 2>/dev/null | head -20 || pip list 2>/dev/null | head -20",
          timeout: 30000,
        }),
      })

      const result = await response.json()
      console.log(`  Installed packages:\n${result.output.trim()}`)
    })
  }

  async testUniverSDK() {
    await this.runTest("Univer SDK Import", async () => {
      const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: `python3 -c "
try:
    from veritly_univer_sdk import RangeRect, UniverSDK
    print('SUCCESS: Univer SDK imported successfully')
    print('Available classes:', dir())
except ImportError as e:
    print('ERROR: Failed to import Univer SDK:', str(e))
    exit(1)
except Exception as e:
    print('ERROR: Unexpected error:', str(e))
    exit(1)
"`,
          timeout: 30000,
        }),
      })

      const result = await response.json()
      if (result.exitCode !== 0) {
        throw new Error(`Univer SDK import failed: ${result.output}`)
      }
      if (!result.output.includes("SUCCESS")) {
        throw new Error(`Univer SDK test did not succeed: ${result.output}`)
      }
      console.log(`  ${result.output.trim()}`)
    })
  }

  async testUniverSDKConnection() {
    await this.runTest("Univer SDK Connection (without relay)", async () => {
      // This tests that the SDK can be instantiated even without a relay
      // The SDK should handle the case where the relay is not available
      const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: `python3 -c "
import asyncio
import os
from veritly_univer_sdk import RangeRect, UniverSDK

# Set a test URL (won't actually connect)
os.environ['UNIVER_SDK_WS'] = 'ws://localhost:99999/ws'

async def test():
    try:
        sdk = UniverSDK()
        print('SUCCESS: SDK instantiated')
        print('SDK URL:', sdk.url if hasattr(sdk, 'url') else 'default')
        # Don't actually connect - just verify the SDK is functional
        return True
    except Exception as e:
        print('ERROR:', str(e))
        return False

result = asyncio.run(test())
exit(0 if result else 1)
"`,
          timeout: 30000,
        }),
      })

      const result = await response.json()
      if (result.exitCode !== 0) {
        throw new Error(`Univer SDK connection test failed: ${result.output}`)
      }
      console.log(`  ${result.output.trim()}`)
    })
  }

  async testSessionIsolation() {
    await this.runTest("Session Isolation", async () => {
      // Create a file in our session
      const response1 = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "echo 'session1-data' > /workspace/isolation-test.txt",
          timeout: 30000,
        }),
      })

      await response1.json()

      // Create a different session
      const session2Id = `test-${uuidv4()}`
      const response2 = await fetch(`${EXECUTOR_URL}/v1/sessions/${session2Id}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "cat /workspace/isolation-test.txt 2>&1 || echo 'FILE_NOT_FOUND'",
          timeout: 30000,
        }),
      })

      const result2 = await response2.json()
      // The file should NOT exist in the second session (isolation)
      if (result2.output.includes("session1-data")) {
        throw new Error("Session isolation broken - file from session 1 visible in session 2")
      }
      console.log(`  Session 2 cannot see Session 1's file (isolation working)`)
    })
  }

  async testSessionRecreation() {
    await this.runTest("Session VM Recreation", async () => {
      // Close the session
      const closeResponse = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/close`, {
        method: "POST",
      })

      if (!closeResponse.ok) {
        throw new Error(`Failed to close session: ${closeResponse.status}`)
      }

      // Try to execute again - should create new VM
      const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "echo 'Recreated session works!'",
          timeout: 30000,
        }),
      })

      if (!response.ok) {
        throw new Error(`Session recreation failed: ${response.status}`)
      }

      const result = await response.json()
      if (!result.output.includes("Recreated session works")) {
        throw new Error(`Unexpected output after recreation: ${result.output}`)
      }
      console.log(`  Session recreated and command executed successfully`)
    })
  }

  async cleanup() {
    try {
      await fetch(`${EXECUTOR_URL}/v1/sessions/${this.sessionId}/close`, {
        method: "POST",
      })
    } catch {
      // Ignore cleanup errors
    }
  }

  printSummary() {
    const passed = this.results.filter((r) => r.passed).length
    const failed = this.results.filter((r) => !r.passed).length
    const total = this.results.length
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0)

    console.log("\n" + "=".repeat(60))
    console.log("INTEGRATION TEST SUMMARY")
    console.log("=".repeat(60))
    console.log(`Total tests: ${total}`)
    console.log(`Passed: ${passed} ✓`)
    console.log(`Failed: ${failed} ✗`)
    console.log(`Total duration: ${totalDuration}ms`)
    console.log("=".repeat(60))

    if (failed > 0) {
      console.log("\nFailed tests:")
      this.results
        .filter((r) => !r.passed)
        .forEach((r) => {
          console.log(`  - ${r.name}: ${r.error}`)
        })
      process.exit(1)
    } else {
      console.log("\n🎉 All tests passed!")
      process.exit(0)
    }
  }
}

async function main() {
  console.log("=".repeat(60))
  console.log("Veritly Executor + Univer SDK Integration Test")
  console.log("=".repeat(60))
  console.log(`Executor URL: ${EXECUTOR_URL}`)
  console.log("=".repeat(60) + "\n")

  const runner = new TestRunner()

  try {
    // Basic executor tests
    await runner.testExecutorHealth()
    await runner.testBasicCommand()
    await runner.testWorkingDirectory()
    await runner.testSessionIsolation()

    // Python environment tests
    await runner.testPythonAvailability()
    await runner.testPipPackages()

    // Univer SDK tests
    await runner.testUniverSDK()
    await runner.testUniverSDKConnection()

    // Lifecycle tests
    await runner.testSessionRecreation()
  } finally {
    await runner.cleanup()
    runner.printSummary()
  }
}

main().catch((error) => {
  console.error("Test runner failed:", error)
  process.exit(1)
})
