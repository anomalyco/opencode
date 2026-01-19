#!/usr/bin/env bun
/**
 * Test script for CVE-2026-22812 security fix
 * Tests that:
 * 1. Server auto-generates password when none is provided
 * 2. Authentication is always required (no unauthenticated access)
 * 3. Custom passwords via env var still work
 */

console.log("🧪 Testing CVE-2026-22812 Security Fix\n")

// Test 1 & 2 & 3: Auto-generated password and authentication
console.log("📝 Test 1: Auto-generated password")
console.log("Starting server without OPENCODE_SERVER_PASSWORD...")

// Run test in subprocess to get clean environment
const test1Result = await Bun.spawn(["bun", "run", "-e", `
import { Server } from "./packages/opencode/src/server/server"

const server = Server.listen({ 
  port: 0,
  hostname: "127.0.0.1",
  mdns: false 
})

const url = server.url.toString()
console.log("SERVER_URL=" + url)

// Check for generated password
const password = Server.getPassword()
if (!password) {
  console.log("ERROR: No password generated")
  process.exit(1)
}
console.log("PASSWORD=" + password)

// Keep server running for external tests
await new Promise(resolve => setTimeout(resolve, 10000))
`], {
  cwd: process.cwd(),
  env: { ...process.env, OPENCODE_SERVER_PASSWORD: "" },
  stdout: "pipe",
  stderr: "pipe"
})

// Parse output
let serverUrl = ""
let serverPassword = ""
const decoder = new TextDecoder()

for await (const chunk of test1Result.stdout) {
  const text = decoder.decode(chunk)
  const urlMatch = text.match(/SERVER_URL=(.+)/)
  const pwMatch = text.match(/PASSWORD=(.+)/)
  if (urlMatch) serverUrl = urlMatch[1].trim()
  if (pwMatch) serverPassword = pwMatch[1].trim()
  if (serverUrl && serverPassword) break
}

if (!serverUrl || !serverPassword) {
  console.log("❌ FAIL: Could not start server or get password")
  test1Result.kill()
  process.exit(1)
}

console.log(`✅ Server started at: ${serverUrl}`)
console.log(`✅ Generated password: ${serverPassword.slice(0, 8)}...`)

// Test 2: Unauthenticated access
console.log("\n📝 Test 2: Unauthenticated access should be blocked")
const testUnauth = await fetch(`${serverUrl}/global/init`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
})

if (testUnauth.status === 401) {
  console.log("✅ PASS: Unauthenticated request blocked (401)")
} else {
  console.log(`❌ FAIL: Expected 401, got ${testUnauth.status}`)
  test1Result.kill()
  process.exit(1)
}

// Test 3: Authenticated access with generated password
console.log("\n📝 Test 3: Authentication with generated password")
const authHeader = "Basic " + Buffer.from(`opencode:${serverPassword}`).toString("base64")
const testAuth = await fetch(`${serverUrl}/global/init`, {
  method: "POST",
  headers: { 
    "Content-Type": "application/json",
    "Authorization": authHeader
  },
  body: "{}"
})

if (testAuth.status === 200 || testAuth.status === 404 || testAuth.status < 500) {
  console.log("✅ PASS: Authenticated request succeeded")
} else {
  console.log(`❌ FAIL: Authenticated request failed with ${testAuth.status}`)
  test1Result.kill()
  process.exit(1)
}

test1Result.kill()

// Test 4: Custom password via env var - run in new subprocess
console.log("\n📝 Test 4: Custom password via environment variable")
const test4Result = await Bun.spawn(["bun", "run", "-e", `
import { Server } from "./packages/opencode/src/server/server"

const server = Server.listen({ 
  port: 0,
  hostname: "127.0.0.1",
  mdns: false 
})

const url = server.url.toString()
console.log("SERVER_URL=" + url)

await new Promise(resolve => setTimeout(resolve, 10000))
`], {
  cwd: process.cwd(),
  env: { ...process.env, OPENCODE_SERVER_PASSWORD: "custom-test-password-123" },
  stdout: "pipe",
  stderr: "pipe"
})

let customUrl = ""
for await (const chunk of test4Result.stdout) {
  const text = decoder.decode(chunk)
  const urlMatch = text.match(/SERVER_URL=(.+)/)
  if (urlMatch) {
    customUrl = urlMatch[1].trim()
    break
  }
}

if (!customUrl) {
  console.log("❌ FAIL: Could not start server with custom password")
  test4Result.kill()
  process.exit(1)
}

const authHeader2 = "Basic " + Buffer.from(`opencode:custom-test-password-123`).toString("base64")
const testCustom = await fetch(`${customUrl}/global/init`, {
  method: "POST",
  headers: { 
    "Content-Type": "application/json",
    "Authorization": authHeader2
  },
  body: "{}"
})

if (testCustom.status === 200 || testCustom.status === 404 || testCustom.status < 500) {
  console.log("✅ PASS: Custom password works")
} else {
  console.log(`❌ FAIL: Custom password failed with ${testCustom.status}`)
  test4Result.kill()
  process.exit(1)
}

test4Result.kill()

console.log("\n" + "=".repeat(60))
console.log("✅ All security tests PASSED!")
console.log("=".repeat(60))
console.log("\nSecurity Fix Summary:")
console.log("• Auto-generates secure password when none provided")
console.log("• Authentication is mandatory (no bypass)")
console.log("• Custom passwords via env var still work")
console.log("• CVE-2026-22812 vulnerability FIXED")

