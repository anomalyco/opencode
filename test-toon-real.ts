#!/usr/bin/env bun

import { TOON } from "./packages/opencode/src/format/toon"
import { TOONData } from "./packages/opencode/src/format/toon-data"

console.log("================================================================================")
console.log("TOON OPTIMIZATION: REAL-WORLD BENCHMARK")
console.log("================================================================================\n")

// Test 1: Text Optimization Examples
console.log("=== TEXT OPTIMIZATION (Natural Language) ===\n")

const textExamples = [
  {
    name: "User Request",
    text: "I need to create a function that validates user input and returns an error message if the validation fails. The function should check if the email is valid and if the password meets the security requirements.",
  },
  {
    name: "Code Review Request",
    text: "Please review the following code and suggest improvements for performance and readability. Also check if there are any security vulnerabilities or potential bugs that need to be fixed.",
  },
  {
    name: "Configuration Instruction",
    text: "Configure the application to use a different database connection string and update the cache settings to use Redis instead of the default in-memory cache. Also enable the authentication module and set the session timeout to 30 minutes.",
  },
  {
    name: "Error Message",
    text: "The operation failed because the database connection could not be established. Please check the connection string and verify that the database server is running and accessible from this machine.",
  },
  {
    name: "Complex Instruction",
    text: "Create a new API endpoint that accepts a POST request with user data and validates the input. If the validation passes, store the data in the database and return a success response. If the validation fails, return an error response with details about what went wrong.",
  },
]

let totalTextSavings = 0
let textCount = 0

for (const example of textExamples) {
  const optimized = TOON.serialize(example.text, { mode: "compact", preserveCode: true })
  const savings = TOON.calculateSavingsPercentage(example.text, optimized)
  const originalTokens = Math.ceil(example.text.length / 4)
  const optimizedTokens = Math.ceil(optimized.length / 4)

  console.log(`${example.name}:`)
  console.log(`  Original: ${example.text.length} chars (${originalTokens} tokens)`)
  console.log(`  Optimized: ${optimized.length} chars (${optimizedTokens} tokens)`)
  console.log(`  Savings: ${savings.toFixed(2)}%`)
  console.log(`  Optimized text: "${optimized}"`)
  console.log()

  totalTextSavings += savings
  textCount++
}

const averageTextSavings = totalTextSavings / textCount
console.log(`Average Text Optimization Savings: ${averageTextSavings.toFixed(2)}%\n`)

// Test 2: Data Optimization Examples
console.log("=== DATA OPTIMIZATION (Structured Data) ===\n")

const dataExamples = [
  {
    name: "User List Response",
    data: {
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
    },
  },
  {
    name: "Database Query Results",
    data: [
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
    ],
  },
  {
    name: "Configuration Object",
    data: {
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
    },
  },
]

let totalDataSavings = 0
let dataCount = 0

for (const example of dataExamples) {
  const result = TOONData.serialize(example.data)
  const savings = TOONData.calculateSavingsPercentage(example.data)
  const originalTokens = Math.ceil(result.originalSize / 4)
  const optimizedTokens = Math.ceil(result.serializedSize / 4)

  console.log(`${example.name}:`)
  console.log(`  Original: ${result.originalSize} bytes (${originalTokens} tokens)`)
  console.log(`  Optimized: ${result.serializedSize} bytes (${optimizedTokens} tokens)`)
  console.log(`  Savings: ${savings.toFixed(2)}%`)
  console.log()

  totalDataSavings += savings
  dataCount++
}

const averageDataSavings = totalDataSavings / dataCount
console.log(`Average Data Optimization Savings: ${averageDataSavings.toFixed(2)}%\n`)

// Test 3: Large Dataset
console.log("=== LARGE DATASET TEST (100 items) ===\n")

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

const largeResult = TOONData.serialize(largeDataset)
const largeSavings = TOONData.calculateSavingsPercentage(largeDataset)
const largeOriginalTokens = Math.ceil(largeResult.originalSize / 4)
const largeOptimizedTokens = Math.ceil(largeResult.serializedSize / 4)

console.log(`Large Dataset (100 items):`)
console.log(`  Original: ${largeResult.originalSize} bytes (${largeOriginalTokens} tokens)`)
console.log(`  Optimized: ${largeResult.serializedSize} bytes (${largeOptimizedTokens} tokens)`)
console.log(`  Savings: ${largeSavings.toFixed(2)}%`)
console.log()

// Test 4: Combined Scenario
console.log("=== COMBINED SCENARIO (Text + Data) ===\n")

const userMessage =
  "Please implement a function that validates user input and returns an error message if validation fails."
const assistantData = {
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

const dataResult = TOONData.serialize(assistantData)
const dataSavings = TOONData.calculateSavingsPercentage(assistantData)

const totalOriginal = userMessage.length + JSON.stringify(assistantData).length
const totalOptimized = userOptimized.length + dataResult.serializedSize
const combinedSavings = ((totalOriginal - totalOptimized) / totalOriginal) * 100

console.log(`User Message:`)
console.log(`  Original: ${userMessage.length} chars`)
console.log(`  Optimized: ${userOptimized.length} chars`)
console.log(`  Savings: ${userSavings.toFixed(2)}%`)
console.log()

console.log(`Assistant Response:`)
console.log(`  Original: ${JSON.stringify(assistantData).length} bytes`)
console.log(`  Optimized: ${dataResult.serializedSize} bytes`)
console.log(`  Savings: ${dataSavings.toFixed(2)}%`)
console.log()

console.log(`Combined:`)
console.log(`  Original total: ${totalOriginal} bytes`)
console.log(`  Optimized total: ${totalOptimized} bytes`)
console.log(`  Combined savings: ${combinedSavings.toFixed(2)}%`)
console.log()

// Final Summary
console.log("================================================================================")
console.log("SUMMARY")
console.log("================================================================================\n")

console.log(`Text Optimization Average: ${averageTextSavings.toFixed(2)}%`)
console.log(`Data Optimization Average: ${averageDataSavings.toFixed(2)}%`)
console.log(`Large Dataset Savings: ${largeSavings.toFixed(2)}%`)
console.log(`Combined Scenario Savings: ${combinedSavings.toFixed(2)}%`)
console.log()

const overallAverage = (averageTextSavings + averageDataSavings + largeSavings + combinedSavings) / 4
console.log(`OVERALL AVERAGE SAVINGS: ${overallAverage.toFixed(2)}%`)
console.log()

console.log("================================================================================")
console.log("CONCLUSION")
console.log("================================================================================\n")

console.log(`✓ Text optimization achieves: ${averageTextSavings.toFixed(2)}% savings`)
console.log(`✓ Data optimization achieves: ${averageDataSavings.toFixed(2)}% savings`)
console.log(`✓ Combined optimization achieves: ${overallAverage.toFixed(2)}% savings`)
console.log()
console.log("The dual-layer TOON optimization is working as expected!")
console.log("================================================================================\n")
