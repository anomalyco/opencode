# Storage Adapter for R2

The storage adapter provides a typeclass-based abstraction for R2 storage operations, allowing for easy mocking and testing while maintaining type safety.

## Overview

The storage adapter implements a functional programming pattern with:

- **Typeclass Interface**: `StorageAdapter<T>` defines the contract for storage operations
- **Concrete Implementation**: `R2StorageAdapter<T>` wraps Cloudflare R2 buckets
- **Mock Implementation**: `MockStorageAdapter<T>` for testing
- **Functional Utilities**: Higher-order functions in the `Storage` namespace

## Usage

### Basic Usage with R2

```typescript
import { createStorageAdapter } from "./storage"

// In a Cloudflare Worker context
export default {
  async fetch(request: Request, env: Env) {
    // Create storage adapter for credentials
    const credentialsStorage = createStorageAdapter<ShareCredentials>(env.SESSIONS_STORE)

    // Store credentials
    await credentialsStorage.put(`credentials/${shareID}`, credentialsData, {
      httpMetadata: {
        contentType: "application/json",
      },
    })

    // Retrieve credentials
    const credentials = await credentialsStorage.get(`credentials/${shareID}`)

    // Delete credentials
    await credentialsStorage.delete(`credentials/${shareID}`)
  },
}
```

### Using the Mock Adapter for Testing

```typescript
import { MockStorageAdapter } from "./storage"

const mockStorage = new MockStorageAdapter<ShareCredentials>()

// Test operations
await mockStorage.put("test-key", { id: "test", secret: "secret123" })
const result = await mockStorage.get("test-key")

// Clear all data for next test
mockStorage.clear()
```

### Functional Utilities

The `Storage` namespace provides higher-order functions for common patterns:

#### withValue - Apply function to retrieved value

```typescript
import { Storage } from "./storage"

const result = await Storage.withValue(storageAdapter, "some-key", (value) => value.count * 2)
// Returns transformed value or null if key doesn't exist
```

#### update - Transform and store value

```typescript
import { Storage } from "./storage"

await Storage.update(storageAdapter, "counter-key", (current) => ({
  count: (current?.count || 0) + 1,
}))
// Creates new value if key doesn't exist
```

#### existsWhere - Check existence with predicate

```typescript
import { Storage } from "./storage"

const hasValidSession = await Storage.existsWhere(
  storageAdapter,
  "session-key",
  (session) => session.isActive && !session.isExpired,
)
```

#### transaction - Multiple operations

```typescript
import { Storage } from "./storage"

await Storage.transaction(storageAdapter, [
  () => storageAdapter.put("key1", value1),
  () => storageAdapter.put("key2", value2),
  () => storageAdapter.delete("old-key"),
])
```

## Type Safety

The storage adapter is fully type-safe:

```typescript
// Type-safe storage for specific data types
const credentialsStorage = createStorageAdapter<ShareCredentials>(bucket)
const sessionsStorage = createStorageAdapter<AgentSession>(bucket)

// Type errors will be caught at compile time
await credentialsStorage.put("key", { invalid: "data" }) // Type error!
```

## Architecture Benefits

1. **Abstraction**: Hide R2 implementation details behind clean interface
2. **Testability**: Easy to mock for unit testing
3. **Type Safety**: Full TypeScript support with generic types
4. **Functional Style**: Higher-order functions for common patterns
5. **Extensibility**: Easy to add new storage backends

## Implementation Details

### StorageAdapter Interface

```typescript
export interface StorageAdapter<T> {
  put(key: string, value: T, options?: R2PutOptions): Promise<void>
  get(key: string): Promise<T | null>
  delete(key: string): Promise<void>
  list(options?: R2ListOptions): Promise<R2Object[]>
  exists(key: string): Promise<boolean>
}
```

### R2StorageAdapter

Concrete implementation that wraps Cloudflare R2 buckets with proper type safety.

### MockStorageAdapter

In-memory implementation for testing with additional helper methods:

- `clear()` - Clear all stored data
- `getAllKeys()` - Get all stored keys

## Migration Guide

To migrate existing code to use the storage adapter:

### Before (Direct R2 Usage)

```typescript
// Direct R2 operations
await c.env.SESSIONS_STORE.put(`credentials/${shareID}`, JSON.stringify(credentials), {
  httpMetadata: { contentType: "application/json" },
})

const obj = await c.env.SESSIONS_STORE.get(`credentials/${shareID}`)
const credentials = obj ? JSON.parse(await obj.text()) : null
```

### After (Storage Adapter)

```typescript
// Using storage adapter
const credentialsStorage = createStorageAdapter<ShareCredentials>(c.env.SESSIONS_STORE)

await credentialsStorage.put(`credentials/${shareID}`, credentials, {
  httpMetadata: { contentType: "application/json" },
})

const credentials = await credentialsStorage.get(`credentials/${shareID}`)
```

## Testing

Run the storage adapter tests:

```bash
bun test storage.test.ts
```

The test suite includes:

- Basic CRUD operations
- Prefix-based listing
- Functional utility tests
- Type safety verification

## Type System

The storage adapter uses the **generated `worker-configuration.d.ts` types** instead of the deprecated `@cloudflare/workers-types` package. This provides:

- **Up-to-date types**: Always matches your current Wrangler configuration
- **Automatic updates**: Types are regenerated when you run `wrangler types`
- **Project-specific**: Types are tailored to your specific worker configuration

The R2 types (`R2Bucket`, `R2Object`, `R2PutOptions`, etc.) are available globally through the TypeScript configuration:

```json
{
  "compilerOptions": {
    "types": ["node", "./worker-configuration"]
  }
}
```

This means you don't need to import R2 types - they're available globally in your worker code.
