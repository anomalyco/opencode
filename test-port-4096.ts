// Test script to diagnose port 4096 issue
console.log("Testing Bun.serve with port 4096...")

try {
  const server = Bun.serve({
    port: 4096,
    hostname: "0.0.0.0",
    fetch(req) {
      return new Response("Hello from port 4096")
    },
  })
  console.log(`✅ Success! Server running on ${server.url}`)
  server.stop()
} catch (error) {
  console.error("❌ Failed to start server:", error)
  console.error("Error name:", error.name)
  console.error("Error message:", error.message)
  console.error("Error code:", error.code)
}

// Try with port 4097
console.log("\nTesting Bun.serve with port 4097...")
try {
  const server2 = Bun.serve({
    port: 4097,
    hostname: "0.0.0.0",
    fetch(req) {
      return new Response("Hello from port 4097")
    },
  })
  console.log(`✅ Success! Server running on ${server2.url}`)
  server2.stop()
} catch (error) {
  console.error("❌ Failed to start server:", error)
}
