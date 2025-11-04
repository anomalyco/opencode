#!/usr/bin/env bun
/**
 * Standalone KB/RAID System Test
 * Tests the core functionality without requiring full test framework
 * Run: bun test-kb-system.ts
 */

import { RaidKnowledgeBase } from "./src/raid/raid-kb"
import { loadRaidConfig, validateRaidConfig } from "./src/raid/raid-config"
import { unlink } from "node:fs/promises"
import type { RaidConfig } from "./src/raid/raid-types"
import { randomUUID } from "crypto"

const testDbPath = "/tmp/test-raid-kb.db"

// Test configuration
const testConfig: RaidConfig = {
  projectRoot: "/tmp/test-project",
  globalKbPath: "/tmp/test-global-kb",
  dbPath: testDbPath,
  enableAutoIndexing: false,
  maxConcurrentShards: 5,
  apiKey: process.env.OPENAI_API_KEY || "test-key",
  baseUrl: "https://api.openai.com/v1",
  shardModel: "gpt-4o-mini",
  orchModel: "gpt-4o",
  numShards: 10,
  maxTokensPerShard: 4000,
  overlapTokens: 200,
}

// Test results tracking
let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`✅ ${message}`)
  } else {
    failed++
    failures.push(message)
    console.log(`❌ ${message}`)
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  if (actual === expected) {
    passed++
    console.log(`✅ ${message}`)
  } else {
    failed++
    failures.push(`${message} - Expected: ${expected}, Got: ${actual}`)
    console.log(`❌ ${message} - Expected: ${expected}, Got: ${actual}`)
  }
}

async function cleanup() {
  try {
    await unlink(testDbPath)
    await unlink(`${testDbPath}-shm`)
    await unlink(`${testDbPath}-wal`)
  } catch {}
}

async function runTests() {
  console.log("🧪 KB/RAID System Test Suite\n")
  console.log("=".repeat(60))

  await cleanup()

  // Test 1: Configuration
  console.log("\n📋 Test Group: Configuration")
  console.log("-".repeat(60))

  try {
    const config = loadRaidConfig()
    const validation = validateRaidConfig(config)

    assert(config !== null, "Config loads successfully")
    console.log(`   Config DB Path: ${config.dbPath}`)
    console.log(`   Has API Key: ${!!config.apiKey}`)
    console.log(`   Validation: ${validation.valid ? "Valid" : "Invalid"}`)

    if (!validation.valid) {
      console.log(`   Errors: ${validation.errors.join(", ")}`)
    }
  } catch (e) {
    assert(false, `Config loading failed: ${e}`)
  }

  // Test 2: Database Initialization
  console.log("\n📊 Test Group: Database Initialization")
  console.log("-".repeat(60))

  let kb: RaidKnowledgeBase
  try {
    kb = new RaidKnowledgeBase(testConfig)
    assert(true, "KB instance created")

    const stats = kb.getStats()
    assertEqual(stats.totalDocuments, 0, "Initial document count is 0")
    assertEqual(stats.projectDocuments, 0, "Initial project documents is 0")
    assertEqual(stats.globalDocuments, 0, "Initial global documents is 0")
  } catch (e) {
    assert(false, `KB initialization failed: ${e}`)
    return
  }

  // Test 3: Document Ingestion
  console.log("\n📝 Test Group: Document Ingestion")
  console.log("-".repeat(60))

  let doc1Id: string
  let doc2Id: string
  let doc3Id: string

  try {
    const doc1 = await kb.upsertDocument({
      id: randomUUID(),
      title: "Test Document 1",
      content:
        "This is a test document about TypeScript and testing. It contains important information about software development.",
      tags: ["test", "typescript"],
      source: "project",
      filePath: "/test/doc1.md",
    })
    doc1Id = doc1.id

    assert(!!doc1.id, "Document 1 created with ID")
    assertEqual(doc1.title, "Test Document 1", "Document 1 title correct")
    assert(doc1.tokenCount > 0, `Document 1 has token count: ${doc1.tokenCount}`)

    const doc2 = await kb.upsertDocument({
      id: randomUUID(),
      title: "Test Document 2",
      content:
        "This is another test document about Python programming. Python is a versatile language used for many purposes.",
      tags: ["test", "python"],
      source: "project",
      filePath: "/test/doc2.md",
    })
    doc2Id = doc2.id

    assert(!!doc2.id, "Document 2 created with ID")

    const doc3 = await kb.upsertDocument({
      id: randomUUID(),
      title: "Global Document",
      content: "This is a global document about React and JavaScript frameworks.",
      tags: ["react", "javascript"],
      source: "global",
    })
    doc3Id = doc3.id

    assert(!!doc3.id, "Global document created with ID")

    const stats = kb.getStats()
    assertEqual(stats.totalDocuments, 3, "Total documents count is 3")
    assertEqual(stats.projectDocuments, 2, "Project documents count is 2")
    assertEqual(stats.globalDocuments, 1, "Global documents count is 1")
  } catch (e) {
    assert(false, `Document ingestion failed: ${e}`)
  }

  // Test 4: Full-Text Search
  console.log("\n🔍 Test Group: Full-Text Search")
  console.log("-".repeat(60))

  try {
    const tsResults = kb.search("TypeScript", { maxResults: 10 })
    assertEqual(tsResults.length, 1, "TypeScript search returns 1 result")
    assert(
      tsResults[0]?.document.title.includes("Document 1"),
      "TypeScript search finds correct document",
    )

    const pythonResults = kb.search("Python", { maxResults: 10 })
    assertEqual(pythonResults.length, 1, "Python search returns 1 result")

    const testResults = kb.search("test", { maxResults: 10 })
    assert(testResults.length >= 2, `'test' search finds multiple results: ${testResults.length}`)

    const reactResults = kb.search("React", { maxResults: 10 })
    assertEqual(reactResults.length, 1, "React search returns 1 result")
  } catch (e) {
    assert(false, `Full-text search failed: ${e}`)
  }

  // Test 5: Source Filtering
  console.log("\n🎯 Test Group: Source Filtering")
  console.log("-".repeat(60))

  try {
    const projectResults = kb.search("document", {
      maxResults: 10,
      sourceFilter: "project",
    })
    assertEqual(projectResults.length, 2, "Project-only search returns 2 results")

    const globalResults = kb.search("document", {
      maxResults: 10,
      sourceFilter: "global",
    })
    assertEqual(globalResults.length, 1, "Global-only search returns 1 result")
  } catch (e) {
    assert(false, `Source filtering failed: ${e}`)
  }

  // Test 6: Tag Filtering
  console.log("\n🏷️  Test Group: Tag Filtering")
  console.log("-".repeat(60))

  try {
    const typescriptTagged = kb.search("document", {
      maxResults: 10,
      tagsFilter: ["typescript"],
    })
    assertEqual(typescriptTagged.length, 1, "TypeScript tag filter returns 1 result")

    const pythonTagged = kb.search("document", {
      maxResults: 10,
      tagsFilter: ["python"],
    })
    assertEqual(pythonTagged.length, 1, "Python tag filter returns 1 result")

    const testTagged = kb.search("document", {
      maxResults: 10,
      tagsFilter: ["test"],
    })
    assertEqual(testTagged.length, 2, "Test tag filter returns 2 results")
  } catch (e) {
    assert(false, `Tag filtering failed: ${e}`)
  }

  // Test 7: Document Retrieval
  console.log("\n📄 Test Group: Document Retrieval")
  console.log("-".repeat(60))

  try {
    const allDocs = kb.listDocuments({ limit: 10, offset: 0 })
    assertEqual(allDocs.length, 3, "List all documents returns 3")

    const firstDoc = allDocs[0]
    const retrieved = kb.getDocument(firstDoc.id)
    assert(!!retrieved, "Get document by ID succeeds")
    assertEqual(retrieved?.id, firstDoc.id, "Retrieved document ID matches")
  } catch (e) {
    assert(false, `Document retrieval failed: ${e}`)
  }

  // Test 8: Document Deletion
  console.log("\n🗑️  Test Group: Document Deletion")
  console.log("-".repeat(60))

  try {
    const docsBeforeDelete = kb.listDocuments({ limit: 10, offset: 0 })
    const toDelete = docsBeforeDelete[0]

    kb.deleteDocument(toDelete.id)
    const afterDelete = kb.getDocument(toDelete.id)
    assertEqual(afterDelete, null, "Deleted document no longer retrievable")

    const stats = kb.getStats()
    assertEqual(stats.totalDocuments, 2, "Document count decreased after deletion")
  } catch (e) {
    assert(false, `Document deletion failed: ${e}`)
  }

  // Test 9: Clear by Source
  console.log("\n🧹 Test Group: Clear by Source")
  console.log("-".repeat(60))

  try {
    kb.deleteAllDocuments("project")
    const stats = kb.getStats()
    assertEqual(stats.projectDocuments, 0, "Project documents cleared")
    assertEqual(stats.globalDocuments, 1, "Global documents remain")
  } catch (e) {
    assert(false, `Clear by source failed: ${e}`)
  }

  // Test 10: Performance Check
  console.log("\n⚡ Test Group: Performance")
  console.log("-".repeat(60))

  try {
    const startIngest = Date.now()
    for (let i = 0; i < 10; i++) {
      await kb.upsertDocument({
        id: randomUUID(),
        title: `Perf Test Doc ${i}`,
        content: `This is performance test document number ${i}. `.repeat(10),
        tags: ["perf"],
        source: "project",
      })
    }
    const ingestTime = Date.now() - startIngest
    console.log(
      `   ⏱️  Ingested 10 docs in ${ingestTime}ms (${(ingestTime / 10).toFixed(1)}ms/doc)`,
    )
    assert(ingestTime < 5000, "Bulk ingestion completes in reasonable time")

    const startSearch = Date.now()
    for (let i = 0; i < 100; i++) {
      kb.search("performance", { maxResults: 10 })
    }
    const searchTime = Date.now() - startSearch
    console.log(
      `   ⏱️  100 searches in ${searchTime}ms (${(searchTime / 100).toFixed(1)}ms/search)`,
    )
    assert(searchTime < 1000, "Bulk search completes in reasonable time")
  } catch (e) {
    assert(false, `Performance test failed: ${e}`)
  }

  // Final cleanup
  await cleanup()

  // Summary
  console.log("\n" + "=".repeat(60))
  console.log("📊 Test Summary")
  console.log("=".repeat(60))
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`)

  if (failures.length > 0) {
    console.log("\n❌ Failures:")
    failures.forEach((f, i) => console.log(`   ${i + 1}. ${f}`))
  }

  console.log("\n" + "=".repeat(60))

  if (failed === 0) {
    console.log("🎉 All tests passed! KB/RAID system is working correctly.")
    process.exit(0)
  } else {
    console.log("⚠️  Some tests failed. Review the output above.")
    process.exit(1)
  }
}

// Run tests
runTests().catch((e) => {
  console.error("💥 Test suite crashed:", e)
  process.exit(1)
})
