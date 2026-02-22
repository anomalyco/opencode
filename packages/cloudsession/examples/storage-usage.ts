/**
 * Storage Adapter Usage Examples
 * Demonstrates how to use the storage adapter in different scenarios
 */
import { env } from "bun"
import { createStorageAdapter, MockStorageAdapter, Storage } from "../src/storage"
import type { ShareCredentials, AgentSession } from "../src/types"

// Example 1: Basic R2 Storage Usage
async function exampleBasicR2Usage() {
  // In a Cloudflare Worker environment
  const r2Bucket = env.SESSIONS_STORE
  const credentialsStorage = createStorageAdapter<ShareCredentials>(r2Bucket)

  console.log("Example 1: Basic R2 Storage Usage")
  console.log("See STORAGE_ADAPTER.md for complete examples")
}

// Example 2: Mock Storage for Testing
async function exampleMockStorage() {
  const mockStorage = new MockStorageAdapter<ShareCredentials>()

  // Store test data
  const credentials: ShareCredentials = {
    id: "test123",
    secret: "secret456",
    sessionID: "session789",
    url: "https://example.com/api/share/test123",
    createdAt: Date.now(),
  }

  await mockStorage.put("credentials/test123", credentials)

  // Retrieve data
  const retrieved = await mockStorage.get("credentials/test123")
  console.log("Retrieved credentials:", retrieved)

  // Check existence
  const exists = await mockStorage.exists("credentials/test123")
  console.log("Credentials exist:", exists)

  // List with prefix
  const list = await mockStorage.list({ prefix: "credentials/" })
  console.log(
    "Credentials list:",
    list.map((item) => item.key),
  )

  // Clean up
  mockStorage.clear()
}

// Example 3: Functional Utilities
async function exampleFunctionalUtilities() {
  const mockStorage = new MockStorageAdapter<{ count: number }>()

  // Initialize counter
  await Storage.update(mockStorage, "counter", (current) => ({ count: (current?.count || 0) + 1 }))

  // Apply transformation
  const doubled = await Storage.withValue(mockStorage, "counter", (value) => value.count * 2)

  console.log("Doubled counter value:", doubled)

  // Check condition
  const isEven = await Storage.existsWhere(mockStorage, "counter", (value) => value.count % 2 === 0)

  console.log("Is counter even?", isEven)
}

// Example 4: Type-Safe Storage
async function exampleTypeSafeStorage() {
  type UserSession = {
    userId: string
    sessionToken: string
    expiresAt: number
    isActive: boolean
  }

  const sessionStorage = new MockStorageAdapter<UserSession>()

  // Type-safe put operation
  await sessionStorage.put("user/123", {
    userId: "123",
    sessionToken: "abc-def-ghi",
    expiresAt: Date.now() + 3600000, // 1 hour from now
    isActive: true,
  })

  // Type-safe get operation
  const session = await sessionStorage.get("user/123")
  if (session) {
    console.log("User session:", session.userId, "active:", session.isActive)
  }
}

// Run examples
async function runExamples() {
  console.log("=== Storage Adapter Examples ===\n")

  await exampleBasicR2Usage()
  console.log("\n")

  await exampleMockStorage()
  console.log("\n")

  await exampleFunctionalUtilities()
  console.log("\n")

  await exampleTypeSafeStorage()
  console.log("\n=== Examples Complete ===")
}

// Run examples if this file is executed directly
if (import.meta.main) {
  runExamples().catch(console.error)
}

export { exampleBasicR2Usage, exampleMockStorage, exampleFunctionalUtilities, exampleTypeSafeStorage, runExamples }
