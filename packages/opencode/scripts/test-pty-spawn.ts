#!/usr/bin/env bun
/**
 * Manual PTY Spawn Test Script
 *
 * Tests the complete PTY spawning flow:
 * 1. Register a session with current user's identity
 * 2. Spawn a PTY as that user
 * 3. Write a command to the PTY
 * 4. Read the output
 * 5. Clean up (kill PTY, unregister session)
 *
 * PREREQUISITES:
 * - opencode-broker must be running as root:
 *   cd packages/opencode-broker && sudo ./target/release/opencode-broker
 *
 * USAGE:
 *   cd packages/opencode
 *   bun run scripts/test-pty-spawn.ts
 *
 * EXPECTED OUTPUT:
 * - PTY spawns successfully with a ptyId and pid
 * - The `id` command output shows your UID/GID
 * - No errors during cleanup
 */

import { BrokerClient } from "../src/auth/broker-client.ts"

async function main() {
  const client = new BrokerClient()
  const sessionId = `manual-test-${Date.now()}`

  console.log("=== PTY Spawn Test ===\n")

  // Step 1: Verify broker is running
  console.log("1. Checking broker connection...")
  const alive = await client.ping()
  if (!alive) {
    console.error("   ERROR: Broker not responding. Is it running?")
    console.error("   Start with: cd packages/opencode-broker && sudo ./target/release/opencode-broker")
    process.exit(1)
  }
  console.log("   Broker is running ✓\n")

  // Step 2: Register session with current user's identity
  console.log("2. Registering session...")
  const userInfo = {
    username: process.env.USER || "unknown",
    uid: process.getuid?.() || 65534,
    gid: process.getgid?.() || 65534,
    home: process.env.HOME || "/tmp",
    shell: process.env.SHELL || "/bin/sh",
  }
  console.log(`   User: ${userInfo.username} (uid=${userInfo.uid}, gid=${userInfo.gid})`)
  console.log(`   Home: ${userInfo.home}`)
  console.log(`   Shell: ${userInfo.shell}`)

  const registered = await client.registerSession(sessionId, userInfo)
  if (!registered) {
    console.error("   ERROR: Failed to register session")
    process.exit(1)
  }
  console.log(`   Session registered: ${sessionId} ✓\n`)

  // Step 3: Spawn PTY
  console.log("3. Spawning PTY...")
  const spawnResult = await client.spawnPty(sessionId, {
    cols: 80,
    rows: 24,
    term: "xterm-256color",
  })

  if (!spawnResult.success || !spawnResult.ptyId) {
    console.error(`   ERROR: Failed to spawn PTY: ${spawnResult.error}`)
    await client.unregisterSession(sessionId)
    process.exit(1)
  }
  console.log(`   PTY spawned: ${spawnResult.ptyId} (pid=${spawnResult.pid}) ✓\n`)

  // Step 4: Write command to PTY
  await new Promise((r) => setTimeout(r, 5000))

  console.log("4. Writing 'id' command to PTY...")
  const writeSuccess = await client.ptyWrite(spawnResult.ptyId, "id\n")
  if (!writeSuccess) {
    console.error("   ERROR: Failed to write to PTY")
  } else {
    console.log("   Command sent ✓\n")
  }

  // Step 5: Read output (with retry for timing)
  console.log("5. Reading PTY output...")
  // Wait longer for shell to fully initialize (loads profile, nix-daemon, etc.)
  await new Promise((r) => setTimeout(r, 2000))

  const readResult = await client.ptyRead(spawnResult.ptyId)
  if (readResult && readResult.data) {
    const output = Buffer.from(readResult.data, "base64").toString()
    console.log("   Output:")
    console.log("   ---")
    output.split("\n").forEach((line) => console.log(`   ${line}`))
    console.log("   ---\n")

    // Verify the output contains expected UID
    if (output.includes(`uid=${userInfo.uid}`)) {
      console.log(`   ✓ Process running as correct user (uid=${userInfo.uid})`)
    } else {
      console.log(`   ⚠ Could not verify UID in output`)
    }
  } else {
    console.log("   No output (process may still be starting)\n")
  }

  // Step 6: Cleanup
  console.log("\n6. Cleaning up...")

  const killed = await client.killPty(spawnResult.ptyId)
  console.log(`   PTY killed: ${killed ? "✓" : "✗"}`)

  const unregistered = await client.unregisterSession(sessionId)
  console.log(`   Session unregistered: ${unregistered ? "✓" : "✗"}`)

  console.log("\n=== Test Complete ===")
}

main().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
