import { describe, test, expect } from "bun:test"
import { TOON } from "../src/format/toon"
import { TOONData } from "../src/format/toon-data"

describe("TOON Real-World Benchmark", () => {
  describe("Real Conversation Examples", () => {
    test("example 1: typical user request", () => {
      const original = `I need to create a function that validates user input and returns an error message if the validation fails. The function should check if the email is valid and if the password meets the security requirements.`

      const optimized = TOON.serialize(original, { mode: "compact", preserveCode: true })
      const savings = TOON.calculateSavingsPercentage(original, optimized)

      console.log("\n=== Example 1: User Request ===")
      console.log("Original:", original)
      console.log("Optimized:", optimized)
      console.log("Savings:", savings.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(original.length / 4))
      console.log("Optimized tokens:", Math.ceil(optimized.length / 4))

      expect(savings).toBeGreaterThan(20)
    })

    test("example 2: code review request", () => {
      const original = `Please review the following code and suggest improvements for performance and readability. Also check if there are any security vulnerabilities or potential bugs that need to be fixed.`

      const optimized = TOON.serialize(original, { mode: "balanced", preserveCode: true })
      const savings = TOON.calculateSavingsPercentage(original, optimized)

      console.log("\n=== Example 2: Code Review Request ===")
      console.log("Original:", original)
      console.log("Optimized:", optimized)
      console.log("Savings:", savings.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(original.length / 4))
      console.log("Optimized tokens:", Math.ceil(optimized.length / 4))

      expect(savings).toBeGreaterThan(10)
    })

    test("example 3: configuration instruction", () => {
      const original = `Configure the application to use a different database connection string and update the cache settings to use Redis instead of the default in-memory cache. Also enable the authentication module and set the session timeout to 30 minutes.`

      const optimized = TOON.serialize(original, { mode: "compact", preserveCode: true })
      const savings = TOON.calculateSavingsPercentage(original, optimized)

      console.log("\n=== Example 3: Configuration Instruction ===")
      console.log("Original:", original)
      console.log("Optimized:", optimized)
      console.log("Savings:", savings.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(original.length / 4))
      console.log("Optimized tokens:", Math.ceil(optimized.length / 4))

      expect(savings).toBeGreaterThan(20)
    })

    test("example 4: error message", () => {
      const original = `The operation failed because the database connection could not be established. Please check the connection string and verify that the database server is running and accessible from this machine.`

      const optimized = TOON.serialize(original, { mode: "compact", preserveCode: true })
      const savings = TOON.calculateSavingsPercentage(original, optimized)

      console.log("\n=== Example 4: Error Message ===")
      console.log("Original:", original)
      console.log("Optimized:", optimized)
      console.log("Savings:", savings.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(original.length / 4))
      console.log("Optimized tokens:", Math.ceil(optimized.length / 4))

      expect(savings).toBeGreaterThan(20)
    })

    test("example 5: complex instruction", () => {
      const original = `Create a new API endpoint that accepts a POST request with user data and validates the input. If the validation passes, store the data in the database and return a success response. If the validation fails, return an error response with details about what went wrong.`

      const optimized = TOON.serialize(original, { mode: "compact", preserveCode: true })
      const savings = TOON.calculateSavingsPercentage(original, optimized)

      console.log("\n=== Example 5: Complex Instruction ===")
      console.log("Original:", original)
      console.log("Optimized:", optimized)
      console.log("Savings:", savings.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(original.length / 4))
      console.log("Optimized tokens:", Math.ceil(optimized.length / 4))

      expect(savings).toBeGreaterThan(20)
    })
  })

  describe("Real API Response Examples", () => {
    test("example 1: user list response", () => {
      const original = {
        status: "success",
        data: [
          {
            id: 1,
            username: "alice",
            email: "alice@example.com",
            role: "admin",
            created_at: "2024-01-01T00:00:00Z",
            active: true,
          },
          {
            id: 2,
            username: "bob",
            email: "bob@example.com",
            role: "user",
            created_at: "2024-01-02T00:00:00Z",
            active: true,
          },
          {
            id: 3,
            username: "charlie",
            email: "charlie@example.com",
            role: "user",
            created_at: "2024-01-03T00:00:00Z",
            active: false,
          },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 3,
        },
      }

      const result = TOONData.serialize(original)
      const savings = TOONData.calculateSavingsPercentage(original)

      console.log("\n=== Example 1: User List Response ===")
      console.log("Original size:", result.originalSize, "bytes")
      console.log("Optimized size:", result.serializedSize, "bytes")
      console.log("Savings:", result.savingsPercentage.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(result.originalSize / 4))
      console.log("Optimized tokens:", Math.ceil(result.serializedSize / 4))

      expect(savings).toBeGreaterThan(20)
    })

    test("example 2: database query results", () => {
      const original = [
        {
          id: 1,
          title: "First Post",
          content: "Lorem ipsum dolor sit amet, consectetur adipiscing elit",
          author: "Alice",
          views: 100,
          likes: 10,
          created_at: "2024-01-01",
        },
        {
          id: 2,
          title: "Second Post",
          content: "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua",
          author: "Bob",
          views: 200,
          likes: 20,
          created_at: "2024-01-02",
        },
        {
          id: 3,
          title: "Third Post",
          content: "Ut enim ad minim veniam, quis nostrud exercitation ullamco",
          author: "Charlie",
          views: 150,
          likes: 15,
          created_at: "2024-01-03",
        },
      ]

      const result = TOONData.serialize(original)
      const savings = TOONData.calculateSavingsPercentage(original)

      console.log("\n=== Example 2: Database Query Results ===")
      console.log("Original size:", result.originalSize, "bytes")
      console.log("Optimized size:", result.serializedSize, "bytes")
      console.log("Savings:", result.savingsPercentage.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(result.originalSize / 4))
      console.log("Optimized tokens:", Math.ceil(result.serializedSize / 4))

      expect(savings).toBeGreaterThan(25)
    })

    test("example 3: configuration object", () => {
      const original = {
        app: {
          name: "MyApplication",
          version: "1.0.0",
          environment: "production",
          debug: false,
        },
        database: {
          host: "db.example.com",
          port: 5432,
          name: "production_db",
          pool_size: 20,
          ssl: true,
        },
        cache: {
          enabled: true,
          backend: "redis",
          host: "cache.example.com",
          port: 6379,
          ttl: 3600,
        },
        features: {
          authentication: true,
          authorization: true,
          api: true,
          websocket: false,
          analytics: true,
        },
        security: {
          cors_enabled: true,
          rate_limiting: true,
          encryption: "AES-256",
        },
      }

      const result = TOONData.serialize(original)
      const savings = TOONData.calculateSavingsPercentage(original)

      console.log("\n=== Example 3: Configuration Object ===")
      console.log("Original size:", result.originalSize, "bytes")
      console.log("Optimized size:", result.serializedSize, "bytes")
      console.log("Savings:", result.savingsPercentage.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(result.originalSize / 4))
      console.log("Optimized tokens:", Math.ceil(result.serializedSize / 4))

      expect(savings).toBeGreaterThan(15)
    })

    test("example 4: error response", () => {
      const original = {
        status: "error",
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: [
            {
              field: "email",
              message: "Invalid email format",
              value: "not-an-email",
            },
            {
              field: "password",
              message: "Password must be at least 8 characters",
              value: "short",
            },
            {
              field: "age",
              message: "Age must be at least 18",
              value: 16,
            },
          ],
        },
        timestamp: "2024-01-27T20:00:00Z",
      }

      const result = TOONData.serialize(original)
      const savings = TOONData.calculateSavingsPercentage(original)

      console.log("\n=== Example 4: Error Response ===")
      console.log("Original size:", result.originalSize, "bytes")
      console.log("Optimized size:", result.serializedSize, "bytes")
      console.log("Savings:", result.savingsPercentage.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(result.originalSize / 4))
      console.log("Optimized tokens:", Math.ceil(result.serializedSize / 4))

      expect(savings).toBeGreaterThan(20)
    })
  })

  describe("Combined Real-World Scenarios", () => {
    test("scenario 1: full conversation with code", () => {
      const userMessage = `Please implement a function that validates user input and returns an error message if validation fails.`

      const assistantResponse = {
        status: "success",
        code: `function validateUser(user) {
  if (!user.email || !user.email.includes('@')) return { error: 'Invalid email' }
  if (!user.password || user.password.length < 8) return { error: 'Password too short' }
  return { success: true }
}`,
        explanation: "The function validates email format and password length requirements.",
      }

      const userOptimized = TOON.serialize(userMessage, { mode: "balanced", preserveCode: true })
      const userSavings = TOON.calculateSavingsPercentage(userMessage, userOptimized)

      const responseSavings = TOONData.calculateSavingsPercentage(assistantResponse)

      const totalOriginal = userMessage.length + JSON.stringify(assistantResponse).length
      const totalOptimized = userOptimized.length + TOONData.serialize(assistantResponse).serializedSize

      const totalSavings = ((totalOriginal - totalOptimized) / totalOriginal) * 100

      console.log("\n=== Scenario 1: Full Conversation ===")
      console.log("User message savings:", userSavings.toFixed(2) + "%")
      console.log("Response savings:", responseSavings.toFixed(2) + "%")
      console.log("Total savings:", totalSavings.toFixed(2) + "%")
      console.log("Original total:", totalOriginal, "bytes")
      console.log("Optimized total:", totalOptimized, "bytes")

      expect(totalSavings).toBeGreaterThan(15)
    })

    test("scenario 2: large dataset processing", () => {
      // Simulate a large API response with 100 items
      const largeDataset = {
        status: "success",
        data: Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          name: `User ${i + 1}`,
          email: `user${i + 1}@example.com`,
          role: i % 10 === 0 ? "admin" : "user",
          active: i % 3 !== 0,
          created_at: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
        })),
        pagination: {
          page: 1,
          limit: 100,
          total: 1000,
        },
      }

      const result = TOONData.serialize(largeDataset)
      const savings = TOONData.calculateSavingsPercentage(largeDataset)

      console.log("\n=== Scenario 2: Large Dataset (100 items) ===")
      console.log("Original size:", result.originalSize, "bytes")
      console.log("Optimized size:", result.serializedSize, "bytes")
      console.log("Savings:", result.savingsPercentage.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(result.originalSize / 4))
      console.log("Optimized tokens:", Math.ceil(result.serializedSize / 4))
      console.log("Tokens saved:", Math.ceil(result.originalSize / 4) - Math.ceil(result.serializedSize / 4))

      expect(savings).toBeGreaterThan(40)
    })

    test("scenario 3: multi-turn conversation", () => {
      const messages = [
        {
          role: "user",
          content: "Create a function that implements validation and returns an error message if validation fails.",
        },
        {
          role: "assistant",
          content: "Here is a function that validates user input and returns appropriate error messages.",
        },
        {
          role: "user",
          content: "Can you add type annotations and improve the error handling?",
        },
        {
          role: "assistant",
          content: "I have added TypeScript type annotations and improved error handling with specific error codes.",
        },
      ]

      let totalOriginal = 0
      let totalOptimized = 0

      for (const msg of messages) {
        totalOriginal += msg.content.length
        const optimized = TOON.serialize(msg.content, { mode: "balanced", preserveCode: true })
        totalOptimized += optimized.length
      }

      const totalSavings = ((totalOriginal - totalOptimized) / totalOriginal) * 100

      console.log("\n=== Scenario 3: Multi-Turn Conversation ===")
      console.log("Total original:", totalOriginal, "bytes")
      console.log("Total optimized:", totalOptimized, "bytes")
      console.log("Total savings:", totalSavings.toFixed(2) + "%")
      console.log("Original tokens:", Math.ceil(totalOriginal / 4))
      console.log("Optimized tokens:", Math.ceil(totalOptimized / 4))

      expect(totalSavings).toBeGreaterThan(10)
    })
  })

  describe("Summary Statistics", () => {
    test("calculate average savings across all examples", () => {
      const examples = [
        {
          name: "User Request",
          text: "I need to create a function that validates user input and returns an error message if the validation fails.",
          type: "text",
        },
        {
          name: "Code Review",
          text: "Please review the following code and suggest improvements for performance and readability.",
          type: "text",
        },
        {
          name: "Configuration",
          text: "Configure the application to use a different database connection string and update the cache settings.",
          type: "text",
        },
        {
          name: "Error Message",
          text: "The operation failed because the database connection could not be established.",
          type: "text",
        },
      ]

      let totalTextSavings = 0
      let textCount = 0

      for (const example of examples) {
        const optimized = TOON.serialize(example.text, { mode: "compact", preserveCode: true })
        const savings = TOON.calculateSavingsPercentage(example.text, optimized)
        totalTextSavings += savings
        textCount++

        console.log(`${example.name}: ${savings.toFixed(2)}%`)
      }

      const averageTextSavings = totalTextSavings / textCount

      console.log("\n=== SUMMARY ===")
      console.log("Average text optimization savings:", averageTextSavings.toFixed(2) + "%")
      console.log("Expected data optimization savings: 30-60%")
      console.log("Expected combined savings: 40-80%")

      expect(averageTextSavings).toBeGreaterThan(20)
    })
  })
})
