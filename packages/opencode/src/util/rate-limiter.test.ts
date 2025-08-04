import { RateLimiter } from "./rate-limiter"

// Simple test function
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.log(`✗ ${name}: ${error}`)
  }
}

// Simple assertion function
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

async function runTests() {
  console.log("Running RateLimiter tests...")
  
  // Test 1: No wait when rate limit is not set
  await test("No wait when rate limit is not set", async () => {
    const rateLimiter = new RateLimiter()
    const start = Date.now()
    await rateLimiter.wait()
    const end = Date.now()
    // Should execute almost immediately (less than 10ms)
    assert(end - start < 10, "Should execute almost immediately")
  })

  // Test 2: Wait appropriate time for rate limiting
  await test("Wait appropriate time for rate limiting", async () => {
    // 60 requests per minute = 1 request per second = 1000ms between requests
    const rateLimiter = new RateLimiter(60)
    
    // First request should not wait
    const start1 = Date.now()
    await rateLimiter.wait()
    const end1 = Date.now()
    assert(end1 - start1 < 10, "First request should not wait")
    
    // Second request should wait approximately 1000ms
    const start2 = Date.now()
    await rateLimiter.wait()
    const end2 = Date.now()
    const duration = end2 - start2
    // Should wait close to 1000ms (allowing for some variance)
    assert(duration >= 900, "Should wait at least 900ms")
    assert(duration < 1100, "Should wait less than 1100ms")
  })

  // Test 3: Handle different rate limits correctly
  await test("Handle different rate limits correctly", async () => {
    // 30 requests per minute = 1 request every 2 seconds = 2000ms
    const rateLimiter = new RateLimiter(30)
    
    // First request
    const start1 = Date.now()
    await rateLimiter.wait()
    const end1 = Date.now()
    assert(end1 - start1 < 10, "First request should not wait")
    
    // Second request should wait approximately 2000ms
    const start2 = Date.now()
    await rateLimiter.wait()
    const end2 = Date.now()
    const duration = end2 - start2
    // Should wait close to 2000ms (allowing for some variance)
    assert(duration >= 1900, "Should wait at least 1900ms")
    assert(duration < 2100, "Should wait less than 2100ms")
  })
  
  // Test 4: Handle zero requests per minute correctly
  await test("Handle zero requests per minute correctly", async () => {
    const rateLimiter = new RateLimiter(0)
    const start = Date.now()
    await rateLimiter.wait()
    const end = Date.now()
    // Should execute almost immediately (less than 10ms)
    assert(end - start < 10, "Should execute almost immediately")
  })
  
  // Test 5: Handle negative requests per minute correctly
  await test("Handle negative requests per minute correctly", async () => {
    const rateLimiter = new RateLimiter(-1)
    const start = Date.now()
    await rateLimiter.wait()
    const end = Date.now()
    // Should execute almost immediately (less than 10ms)
    assert(end - start < 10, "Should execute almost immediately")
  })
  
  // Test 6: Concurrent requests are properly rate limited
  await test("Concurrent requests are properly rate limited", async () => {
    // 10 requests per minute = 1 request every 6 seconds = 6000ms
    const rateLimiter = new RateLimiter(10)
    
    // First request should not wait
    const start1 = Date.now()
    await rateLimiter.wait()
    const end1 = Date.now()
    assert(end1 - start1 < 10, "First request should not wait")
    
    // Run 3 concurrent requests
    const promises = []
    const start = Date.now()
    for (let i = 0; i < 3; i++) {
      promises.push(rateLimiter.wait())
    }
    
    await Promise.all(promises)
    const end = Date.now()
    const duration = end - start
    
    // Should take at least 18 seconds (3 requests * 6 seconds each)
    // But the first request doesn't count in the waiting time
    // So it should take at least 12 seconds for the remaining 3 requests
    assert(duration >= 11000, `Should wait at least 11000ms for concurrent requests, but waited ${duration}ms`)
  })
  
  // Test 7: Multiple sequential requests
  await test("Multiple sequential requests maintain proper timing", async () => {
    // 20 requests per minute = 1 request every 3 seconds = 3000ms
    const rateLimiter = new RateLimiter(20)
    
    // First request should not wait
    const start1 = Date.now()
    await rateLimiter.wait()
    const end1 = Date.now()
    assert(end1 - start1 < 10, "First request should not wait")
    
    // Second request should wait approximately 3000ms
    const start2 = Date.now()
    await rateLimiter.wait()
    const end2 = Date.now()
    const duration2 = end2 - start2
    
    // Third request should also wait approximately 3000ms from the second request
    const start3 = Date.now()
    await rateLimiter.wait()
    const end3 = Date.now()
    const duration3 = end3 - start3
    
    // Should wait close to 3000ms for each request
    assert(duration2 >= 2900, `Second request should wait at least 2900ms, but waited ${duration2}ms`)
    assert(duration2 < 3100, `Second request should wait less than 3100ms, but waited ${duration2}ms`)
    assert(duration3 >= 2900, `Third request should wait at least 2900ms, but waited ${duration3}ms`)
    assert(duration3 < 3100, `Third request should wait less than 3100ms, but waited ${duration3}ms`)
  })

  console.log("All tests completed!")
}

// Run the tests
runTests().catch(console.error)