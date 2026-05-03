#!/usr/bin/env bun
/**
 * Test script for the QEMU executor integration
 *
 * Usage: bun test-executor.ts [session-id]
 */

const EXECUTOR_URL = process.env.VERITLY_EXECUTOR_URL ?? "http://localhost:7777"

async function healthCheck() {
  console.log("Checking executor health...")
  try {
    const response = await fetch(`${EXECUTOR_URL}/readyz`)
    const data = await response.json()
    console.log("✓ Executor is healthy:", data)
    return true
  } catch (err) {
    console.error("✗ Executor health check failed:", err instanceof Error ? err.message : String(err))
    return false
  }
}

async function testCommand(sessionId: string, command: string) {
  console.log(`\nTesting command: ${command}`)
  console.log(`Session: ${sessionId}`)

  try {
    const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${sessionId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeout: 30000 }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`✗ Command failed (${response.status}):`, error)
      return false
    }

    const result = await response.json()
    console.log("✓ Command executed successfully")
    console.log("  Exit code:", result.exitCode)
    console.log("  VM ID:", result.vmId ?? result.mode ?? "unknown")
    console.log("  Output:\n" + "-".repeat(40))
    console.log(result.output)
    console.log("-".repeat(40))
    return true
  } catch (err) {
    console.error("✗ Command execution error:", err instanceof Error ? err.message : String(err))
    return false
  }
}

async function getStatus(sessionId: string) {
  console.log(`\nChecking session status...`)

  try {
    const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${sessionId}/status`)
    if (!response.ok) {
      console.log("  Session not found (VM may have been cleaned up)")
      return null
    }

    const status = await response.json()
    console.log("✓ Session status:", status)
    return status
  } catch (err) {
    console.error("✗ Status check error:", err instanceof Error ? err.message : String(err))
    return null
  }
}

async function closeSession(sessionId: string) {
  console.log(`\nClosing session...`)

  try {
    const response = await fetch(`${EXECUTOR_URL}/v1/sessions/${sessionId}/close`, {
      method: "POST",
    })

    if (response.ok) {
      console.log("✓ Session closed")
      return true
    }
    return false
  } catch (err) {
    console.error("✗ Close session error:", err instanceof Error ? err.message : String(err))
    return false
  }
}

async function main() {
  const sessionId = process.argv[2] ?? `test-session-${Date.now()}`

  console.log("=".repeat(60))
  console.log("Veritly QEMU Executor Test")
  console.log("=".repeat(60))
  console.log(`Executor URL: ${EXECUTOR_URL}`)
  console.log(`Session ID: ${sessionId}`)
  console.log("=".repeat(60))

  // Health check
  if (!(await healthCheck())) {
    console.error("\nExecutor is not available. Make sure it's running:")
    console.error("  docker compose -f docker-compose.e2e.yml up executor")
    process.exit(1)
  }

  // Test basic commands
  const tests = [
    "echo 'Hello from executor!'",
    "pwd",
    "whoami",
    "python3 --version",
    "pip3 list | grep -i univer || echo 'Univer SDK not installed'",
  ]

  for (const command of tests) {
    await testCommand(sessionId, command)
  }

  // Check status
  await getStatus(sessionId)

  // Test VM recreation (simulate expiration)
  console.log("\n" + "=".repeat(60))
  console.log("Testing VM recreation after 'expiration'...")
  console.log("=".repeat(60))

  // Close session
  await closeSession(sessionId)

  // Try command again (should create new VM)
  await testCommand(sessionId, "echo 'New VM created!'")

  // Final status
  await getStatus(sessionId)

  // Cleanup
  await closeSession(sessionId)

  console.log("\n" + "=".repeat(60))
  console.log("Test complete!")
  console.log("=".repeat(60))
}

main().catch((error) => {
  console.error("Test failed:", error)
  process.exit(1)
})
