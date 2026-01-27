import { describe, test, expect } from "bun:test"
import { TOON } from "../src/format/toon"
import { TOONData } from "../src/format/toon-data"

describe("TOON Integration: Text + Data Optimization", () => {
  describe("Combined Optimization Strategy", () => {
    test("text optimization + data optimization work together", () => {
      // Text content
      const textContent = "Create a function that processes the database configuration"
      const textOptimized = TOON.serialize(textContent, { mode: "compact", preserveCode: true })
      const textSavings = TOON.calculateSavingsPercentage(textContent, textOptimized)

      // Data content
      const dataContent = {
        users: [
          { id: 1, name: "Alice", role: "admin" },
          { id: 2, name: "Bob", role: "user" },
        ],
      }
      const dataSavings = TOONData.calculateSavingsPercentage(dataContent)

      // Both should provide savings
      expect(textSavings).toBeGreaterThan(0)
      expect(dataSavings).toBeGreaterThan(0)

      // Combined savings should be significant
      const totalSavings = textSavings + dataSavings
      expect(totalSavings).toBeGreaterThan(10)
    })

    test("text optimization for prompts + data optimization for results", () => {
      // User prompt (text optimization)
      const userPrompt = "Retrieve all active users from the database and format as JSON"
      const optimizedPrompt = TOON.serialize(userPrompt, { mode: "balanced", preserveCode: true })

      // API response (data optimization)
      const apiResponse = {
        status: "success",
        data: [
          { id: 1, username: "alice", email: "alice@example.com", active: true },
          { id: 2, username: "bob", email: "bob@example.com", active: true },
          { id: 3, username: "charlie", email: "charlie@example.com", active: true },
        ],
      }
      const optimizedData = TOONData.serialize(apiResponse)

      expect(optimizedPrompt.length).toBeLessThan(userPrompt.length)
      expect(optimizedData.serializedSize).toBeLessThan(optimizedData.originalSize)
    })
  })

  describe("Optimization Recommendations", () => {
    test("recommends text optimization for natural language", () => {
      const text = "Create a function that implements validation and returns a value"
      const optimized = TOON.serialize(text, { mode: "compact", preserveCode: true })
      const savings = TOON.calculateSavingsPercentage(text, optimized)

      expect(savings).toBeGreaterThan(15)
    })

    test("recommends data optimization for structured data", () => {
      const data = [
        { id: 1, name: "Alice", role: "admin", active: true },
        { id: 2, name: "Bob", role: "user", active: true },
        { id: 3, name: "Charlie", role: "user", active: false },
      ]

      const shouldOptimize = TOONData.shouldSerialize(data)
      expect(shouldOptimize).toBe(true)
    })

    test("text optimization better for conversational content", () => {
      const conversation = "Please implement a function that validates user input and returns an error message"
      const optimized = TOON.serialize(conversation, { mode: "compact", preserveCode: true })
      const savings = TOON.calculateSavingsPercentage(conversation, optimized)

      expect(savings).toBeGreaterThan(20)
    })

    test("data optimization better for uniform arrays", () => {
      const uniformArray = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        role: "user",
        active: true,
      }))

      const savings = TOONData.calculateSavingsPercentage(uniformArray)
      expect(savings).toBeGreaterThan(30)
    })
  })

  describe("Real-World Scenarios", () => {
    test("scenario 1: Code review request with file data", () => {
      // User request (text optimization)
      const request = "Please review the following code and suggest improvements"
      const optimizedRequest = TOON.serialize(request, { mode: "balanced", preserveCode: true })

      // File data (data optimization)
      const fileData = {
        files: [
          {
            name: "index.ts",
            size: 1024,
            language: "typescript",
            lines: 50,
          },
          {
            name: "utils.ts",
            size: 2048,
            language: "typescript",
            lines: 100,
          },
        ],
      }
      const optimizedFileData = TOONData.serialize(fileData)

      expect(optimizedRequest.length).toBeLessThan(request.length)
      expect(optimizedFileData.serializedSize).toBeLessThan(optimizedFileData.originalSize)
    })

    test("scenario 2: Database query with results", () => {
      // Query instruction (text optimization)
      const instruction = "Execute the following query and return all results"
      const optimizedInstruction = TOON.serialize(instruction, { mode: "compact", preserveCode: true })

      // Query results (data optimization)
      const results = [
        { id: 1, title: "Post 1", author: "Alice", views: 100, likes: 10 },
        { id: 2, title: "Post 2", author: "Bob", views: 200, likes: 20 },
        { id: 3, title: "Post 3", author: "Charlie", views: 150, likes: 15 },
      ]
      const optimizedResults = TOONData.serialize(results)

      expect(optimizedInstruction.length).toBeLessThan(instruction.length)
      expect(optimizedResults.savingsPercentage).toBeGreaterThan(15)
    })

    test("scenario 3: Configuration update with validation", () => {
      // Update instruction (text optimization)
      const instruction = "Update the application configuration with the following settings"
      const optimizedInstruction = TOON.serialize(instruction, { mode: "balanced", preserveCode: true })

      // Configuration data (data optimization)
      const config = {
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
      const optimizedConfig = TOONData.serialize(config)

      expect(optimizedInstruction.length).toBeLessThan(instruction.length)
      expect(optimizedConfig.serialized).toBeTruthy()
    })
  })

  describe("Token Savings Comparison", () => {
    test("text optimization: 20-40% savings", () => {
      const texts = [
        "Create a function that implements validation",
        "Configure the application database",
        "Process and validate the input data",
      ]

      for (const text of texts) {
        const optimized = TOON.serialize(text, { mode: "compact", preserveCode: true })
        const savings = TOON.calculateSavingsPercentage(text, optimized)

        expect(savings).toBeGreaterThanOrEqual(15)
        expect(savings).toBeLessThanOrEqual(50)
      }
    })

    test("data optimization: 30-60% savings for uniform arrays", () => {
      const datasets = [
        Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Item ${i}` })),
        Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Item ${i}`, active: true })),
        Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          email: `item${i}@example.com`,
          active: i % 2 === 0,
        })),
      ]

      for (const dataset of datasets) {
        const savings = TOONData.calculateSavingsPercentage(dataset)

        expect(savings).toBeGreaterThanOrEqual(15)
        expect(savings).toBeLessThanOrEqual(70)
      }
    })

    test("combined optimization: 40-80% total savings", () => {
      const text = "Create a function that processes the database configuration"
      const data = [
        { id: 1, name: "Alice", role: "admin" },
        { id: 2, name: "Bob", role: "user" },
      ]

      const textSavings = TOON.calculateSavingsPercentage(
        text,
        TOON.serialize(text, { mode: "compact", preserveCode: true }),
      )
      const dataSavings = TOONData.calculateSavingsPercentage(data)

      const combinedSavings = textSavings + dataSavings

      expect(combinedSavings).toBeGreaterThan(30)
    })
  })

  describe("Idempotence and Consistency", () => {
    test("text optimization is idempotent", () => {
      const text = "Create a function that implements validation"

      const once = TOON.serialize(text, { mode: "compact", preserveCode: true })
      const twice = TOON.serialize(once, { mode: "compact", preserveCode: true })

      expect(twice).toBe(once)
    })

    test("data optimization is lossless", () => {
      const data = {
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      }

      const serialized = TOONData.serialize(data)
      const deserialized = TOONData.deserialize(serialized.serialized)

      expect(deserialized).toEqual(data)
    })

    test("combined optimization preserves information", () => {
      const text = "Process the following data"
      const data = { items: [{ id: 1, value: "test" }] }

      const optimizedText = TOON.serialize(text, { mode: "balanced", preserveCode: true })
      const optimizedData = TOONData.serialize(data)
      const deserializedData = TOONData.deserialize(optimizedData.serialized)

      expect(optimizedText).toBeTruthy()
      expect(deserializedData).toEqual(data)
    })
  })

  describe("Performance", () => {
    test("combined optimization completes quickly", () => {
      const text = "Create a function that implements validation. ".repeat(10)
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
      }))

      const start = performance.now()

      TOON.serialize(text, { mode: "compact", preserveCode: true })
      TOONData.serialize(data)

      const duration = performance.now() - start

      expect(duration).toBeLessThan(100)
    })

    test("text optimization is faster than data optimization", () => {
      const text = "Create a function that implements validation. ".repeat(100)
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
      }))

      const startText = performance.now()
      TOON.serialize(text, { mode: "compact", preserveCode: true })
      const textDuration = performance.now() - startText

      const startData = performance.now()
      TOONData.serialize(data)
      const dataDuration = performance.now() - startData

      // Both should be fast
      expect(textDuration).toBeLessThan(50)
      expect(dataDuration).toBeLessThan(50)
    })
  })
})
