#!/usr/bin/env bun
// Test SDK connection from executor

const testSessionId = `sdk-test-${Date.now()}`

async function testSDK() {
  // Test 1: Check environment variable
  console.log("Test 1: Check UNIVER_SDK_WS environment variable")
  const envResponse = await fetch(`http://localhost:7777/v1/sessions/${testSessionId}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command: "echo UNIVER_SDK_WS=$UNIVER_SDK_WS",
      timeout: 5000,
    }),
  })
  const envResult = await envResponse.json()
  console.log("  Output:", envResult.output.trim())

  // Test 2: Check SDK URL resolution
  console.log("\nTest 2: Check SDK URL resolution")
  const urlResponse = await fetch(`http://localhost:7777/v1/sessions/${testSessionId}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command: "python3 -c 'from veritly_univer_sdk import UniverSDK; s = UniverSDK(); print(\"URL:\", s._ws_url)'",
      timeout: 5000,
    }),
  })
  const urlResult = await urlResponse.json()
  console.log("  Output:", urlResult.output.trim())

  // Test 3: Try to connect (will fail without browser, but shows the URL is correct)
  console.log("\nTest 3: Attempt SDK connection (expected to fail without browser)")
  const connResponse = await fetch(`http://localhost:7777/v1/sessions/${testSessionId}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command:
        "timeout 3 python3 -c 'from veritly_univer_sdk import UniverSDK; import asyncio; async def test(): sdk = UniverSDK(); await sdk.connect(); print(\"Connected!\"); await sdk.close(); asyncio.run(test())' 2>&1 || echo 'Connection attempt completed'",
      timeout: 10000,
    }),
  })
  const connResult = await connResponse.json()
  console.log("  Output:", connResult.output.trim())

  // Cleanup
  await fetch(`http://localhost:7777/v1/sessions/${testSessionId}/close`, { method: "POST" })

  console.log("\n✅ All tests completed!")
}

testSDK().catch(console.error)
