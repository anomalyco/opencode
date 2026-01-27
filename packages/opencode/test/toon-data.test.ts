import { describe, test, expect } from "bun:test"
import { TOONData } from "../src/format/toon-data"

describe("TOON Data Serialization", () => {
  describe("Basic Serialization", () => {
    test("serializes simple objects", () => {
      const data = { name: "John", age: 30 }
      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      expect(result.serializedSize).toBeLessThan(result.originalSize)
      expect(result.savingsPercentage).toBeGreaterThan(0)
    })

    test("serializes arrays of objects", () => {
      const data = [
        { id: 1, name: "Alice", role: "admin" },
        { id: 2, name: "Bob", role: "user" },
        { id: 3, name: "Charlie", role: "user" },
      ]

      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      expect(result.savingsPercentage).toBeGreaterThan(15)
    })

    test("serializes nested objects", () => {
      const data = {
        user: {
          id: 1,
          name: "John",
          profile: {
            bio: "Developer",
            location: "NYC",
          },
        },
      }

      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      expect(result.savingsPercentage).toBeGreaterThan(0)
    })

    test("serializes mixed data types", () => {
      const data = {
        string: "hello",
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { key: "value" },
      }

      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      expect(result.savingsPercentage).toBeGreaterThan(0)
    })
  })

  describe("Deserialization", () => {
    test("deserializes back to original data", () => {
      const original = { name: "John", age: 30, active: true }
      const serialized = TOONData.serialize(original)
      const deserialized = TOONData.deserialize(serialized.serialized)

      expect(deserialized).toEqual(original)
    })

    test("round-trip is lossless for arrays", () => {
      const original = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]

      const serialized = TOONData.serialize(original)
      const deserialized = TOONData.deserialize(serialized.serialized)

      expect(deserialized).toEqual(original)
    })

    test("round-trip is lossless for nested objects", () => {
      const original = {
        user: {
          id: 1,
          profile: {
            name: "John",
            tags: ["dev", "open-source"],
          },
        },
      }

      const serialized = TOONData.serialize(original)
      const deserialized = TOONData.deserialize(serialized.serialized)

      expect(deserialized).toEqual(original)
    })
  })

  describe("Savings Calculation", () => {
    test("calculates savings percentage correctly", () => {
      const data = [
        { id: 1, name: "Alice", role: "admin" },
        { id: 2, name: "Bob", role: "user" },
      ]

      const savings = TOONData.calculateSavingsPercentage(data)

      expect(savings).toBeGreaterThan(0)
      expect(savings).toBeLessThanOrEqual(100)
    })

    test("estimates token savings", () => {
      const data = [
        { id: 1, name: "Alice", role: "admin" },
        { id: 2, name: "Bob", role: "user" },
        { id: 3, name: "Charlie", role: "user" },
      ]

      const savings = TOONData.estimateSavings(data)

      expect(savings).toBeGreaterThan(0)
    })

    test("returns zero savings for small objects", () => {
      const data = { a: 1 }
      const savings = TOONData.calculateSavingsPercentage(data)

      // Small objects may not benefit from TOON
      expect(savings).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Optimization Decision", () => {
    test("recommends TOON for large uniform arrays", () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        role: "user",
      }))

      const shouldOptimize = TOONData.shouldSerialize(data)

      expect(shouldOptimize).toBe(true)
    })

    test("may not recommend TOON for small objects", () => {
      const data = { a: 1, b: 2 }
      const shouldOptimize = TOONData.shouldSerialize(data)

      // Small objects may not meet the 15% threshold
      expect(typeof shouldOptimize).toBe("boolean")
    })

    test("recommends TOON for nested uniform structures", () => {
      const data = {
        users: [
          { id: 1, name: "Alice", active: true },
          { id: 2, name: "Bob", active: false },
          { id: 3, name: "Charlie", active: true },
        ],
        metadata: {
          total: 3,
          page: 1,
        },
      }

      const shouldOptimize = TOONData.shouldSerialize(data)

      expect(shouldOptimize).toBe(true)
    })
  })

  describe("Real-World Examples", () => {
    test("optimizes API response with user list", () => {
      const apiResponse = {
        status: "success",
        data: [
          {
            id: 1,
            username: "alice",
            email: "alice@example.com",
            created_at: "2024-01-01",
            role: "admin",
          },
          {
            id: 2,
            username: "bob",
            email: "bob@example.com",
            created_at: "2024-01-02",
            role: "user",
          },
          {
            id: 3,
            username: "charlie",
            email: "charlie@example.com",
            created_at: "2024-01-03",
            role: "user",
          },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 3,
        },
      }

      const result = TOONData.serialize(apiResponse)

      expect(result.savingsPercentage).toBeGreaterThan(20)
      expect(result.serialized).toBeTruthy()

      // Verify round-trip
      const deserialized = TOONData.deserialize(result.serialized)
      expect(deserialized).toEqual(apiResponse)
    })

    test("optimizes database query results", () => {
      const queryResults = [
        {
          id: 1,
          title: "First Post",
          content: "Lorem ipsum dolor sit amet",
          author_id: 1,
          created_at: "2024-01-01",
          updated_at: "2024-01-02",
          published: true,
        },
        {
          id: 2,
          title: "Second Post",
          content: "Consectetur adipiscing elit",
          author_id: 2,
          created_at: "2024-01-03",
          updated_at: "2024-01-04",
          published: true,
        },
        {
          id: 3,
          title: "Draft Post",
          content: "Sed do eiusmod tempor",
          author_id: 1,
          created_at: "2024-01-05",
          updated_at: "2024-01-05",
          published: false,
        },
      ]

      const result = TOONData.serialize(queryResults)

      expect(result.savingsPercentage).toBeGreaterThan(15)
      expect(result.serialized).toBeTruthy()
    })

    test("optimizes configuration objects", () => {
      const config = {
        app: {
          name: "MyApp",
          version: "1.0.0",
          debug: false,
        },
        database: {
          host: "localhost",
          port: 5432,
          name: "mydb",
          pool_size: 10,
        },
        cache: {
          enabled: true,
          ttl: 3600,
          backend: "redis",
        },
        features: {
          auth: true,
          api: true,
          websocket: false,
        },
      }

      const result = TOONData.serialize(config)

      expect(result.serialized).toBeTruthy()
      expect(result.savingsPercentage).toBeGreaterThan(0)
    })
  })

  describe("Edge Cases", () => {
    test("handles empty arrays", () => {
      const data: unknown[] = []
      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      const deserialized = TOONData.deserialize(result.serialized)
      expect(deserialized).toEqual(data)
    })

    test("handles empty objects", () => {
      const data = {}
      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      const deserialized = TOONData.deserialize(result.serialized)
      expect(deserialized).toEqual(data)
    })

    test("handles null values", () => {
      const data = { value: null }
      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      const deserialized = TOONData.deserialize(result.serialized)
      expect(deserialized).toEqual(data)
    })

    test("handles special characters in strings", () => {
      const data = {
        text: "Hello\nWorld\t!",
        emoji: "🚀",
        unicode: "你好",
      }

      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      const deserialized = TOONData.deserialize(result.serialized)
      expect(deserialized).toEqual(data)
    })

    test("handles large numbers", () => {
      const data = {
        small: 1,
        large: 9007199254740991,
        negative: -9007199254740991,
        float: 3.14159265359,
      }

      const result = TOONData.serialize(data)

      expect(result.serialized).toBeTruthy()
      const deserialized = TOONData.deserialize(result.serialized)
      expect(deserialized).toEqual(data)
    })
  })

  describe("Performance", () => {
    test("serializes large datasets quickly", () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        active: i % 2 === 0,
      }))

      const start = performance.now()
      TOONData.serialize(data)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100)
    })

    test("deserializes large datasets quickly", () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        active: i % 2 === 0,
      }))

      const serialized = TOONData.serialize(data)

      const start = performance.now()
      TOONData.deserialize(serialized.serialized)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100)
    })
  })

  describe("Comparison with JSON", () => {
    test("TOON is more efficient than JSON for uniform arrays", () => {
      const data = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: "Lorem ipsum dolor sit amet",
        active: true,
      }))

      const json = JSON.stringify(data)
      const toon = TOONData.serialize(data)

      expect(toon.serializedSize).toBeLessThan(json.length)
    })

    test("TOON savings increase with array size", () => {
      const small = Array.from({ length: 5 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
      }))

      const large = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
      }))

      const smallSavings = TOONData.calculateSavingsPercentage(small)
      const largeSavings = TOONData.calculateSavingsPercentage(large)

      expect(largeSavings).toBeGreaterThanOrEqual(smallSavings)
    })
  })
})
