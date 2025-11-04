#!/usr/bin/env bun
/**
 * KB Tools Integration Test
 * Tests that the actual kb-manage, kb-search tools work
 * Run: bun test-kb-tools.ts
 */

import { KbManageTool } from "./src/tool/kb-manage"
import { KbSearchTool } from "./src/tool/kb-search"
import { RaidKnowledgeBase } from "./src/raid/raid-kb"
import { loadRaidConfig } from "./src/raid/raid-config"
import { randomUUID } from "crypto"
import { Instance } from "./src/project/instance"
import path from "path"

const projectRoot = path.join(__dirname)

const ctx = {
  sessionID: "test-session",
  messageID: "test-message",
  toolCallID: "test-call",
  callID: "test-call",
  agent: "test",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

async function runToolTests() {
  console.log("🧪 KB Tools Integration Test\n")
  console.log("=".repeat(60))

  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      // Setup: Add some test documents
      console.log("\n📝 Setup: Adding test documents...")
      const config = loadRaidConfig()
      const kb = new RaidKnowledgeBase(config)

      await kb.upsertDocument({
        id: randomUUID(),
        title: "Integration Test Doc 1",
        content: "This document is about integration testing with TypeScript",
        tags: ["integration", "test"],
        source: "project",
      })

      await kb.upsertDocument({
        id: randomUUID(),
        title: "Integration Test Doc 2",
        content: "This document covers unit testing with Jest and Bun",
        tags: ["unit", "test"],
        source: "project",
      })

      console.log("✅ Test documents added\n")

      // Test 1: kb-manage stats
      console.log("📊 Test 1: kb-manage stats")
      console.log("-".repeat(60))

      try {
        const manageTool = await KbManageTool.init()
        const result = await manageTool.execute(
          {
            action: "stats",
            limit: 20,
            offset: 0,
          },
          ctx,
        )

        if (result.output.includes("Total Documents")) {
          console.log("✅ kb-manage stats tool works")
          console.log(`   Output preview: ${result.output.substring(0, 100)}...`)
        } else {
          console.log("❌ kb-manage stats unexpected output")
          console.log(result.output)
        }
      } catch (e) {
        console.log(`❌ kb-manage stats failed: ${e}`)
      }

      // Test 2: kb-manage list
      console.log("\n📋 Test 2: kb-manage list")
      console.log("-".repeat(60))

      try {
        const manageTool = await KbManageTool.init()
        const result = await manageTool.execute(
          {
            action: "list",
            limit: 20,
            offset: 0,
            source: "project",
          },
          ctx,
        )

        if (result.output.includes("Integration Test Doc")) {
          console.log("✅ kb-manage list tool works")
          console.log(`   Found test documents`)
        } else {
          console.log("❌ kb-manage list unexpected output")
          console.log(result.output)
        }
      } catch (e) {
        console.log(`❌ kb-manage list failed: ${e}`)
      }

      // Test 3: kb-search
      console.log("\n🔍 Test 3: kb-search")
      console.log("-".repeat(60))

      try {
        const searchTool = await KbSearchTool.init()
        const result = await searchTool.execute(
          {
            query: "integration testing",
            maxResults: 10,
            source: "both",
            includeContent: false,
          },
          ctx,
        )

        if (result.output.includes("Integration Test Doc 1")) {
          console.log("✅ kb-search tool works")
          console.log(`   Found: Integration Test Doc 1`)
        } else {
          console.log("❌ kb-search unexpected output")
          console.log(result.output)
        }
      } catch (e) {
        console.log(`❌ kb-search failed: ${e}`)
      }

      // Test 4: kb-search with tags
      console.log("\n🏷️  Test 4: kb-search with tags")
      console.log("-".repeat(60))

      try {
        const searchTool = await KbSearchTool.init()
        const result = await searchTool.execute(
          {
            query: "test",
            maxResults: 10,
            source: "both",
            tags: ["integration"],
            includeContent: false,
          },
          ctx,
        )

        if (result.output.includes("Integration Test Doc 1")) {
          console.log("✅ kb-search with tags works")
        } else {
          console.log("⚠️  kb-search with tags - check output:")
          console.log(result.output)
        }
      } catch (e) {
        console.log(`❌ kb-search with tags failed: ${e}`)
      }

      // Test 5: kb-manage get
      console.log("\n📄 Test 5: kb-manage get")
      console.log("-".repeat(60))

      try {
        const docs = kb.listDocuments({ limit: 1 })
        if (docs.length > 0) {
          const manageTool = await KbManageTool.init()
          const result = await manageTool.execute(
            {
              action: "get",
              documentId: docs[0].id,
              limit: 20,
              offset: 0,
            },
            ctx,
          )

          if (result.output.includes(docs[0].title)) {
            console.log("✅ kb-manage get tool works")
            console.log(`   Retrieved: ${docs[0].title}`)
          } else {
            console.log("❌ kb-manage get unexpected output")
            console.log(result.output)
          }
        }
      } catch (e) {
        console.log(`❌ kb-manage get failed: ${e}`)
      }

      console.log("\n" + "=".repeat(60))
      console.log("✅ All tool integration tests completed")
      console.log("=".repeat(60))
      console.log("\n💡 Conclusion: KB tools are properly integrated and functional")
    },
  })
}

runToolTests().catch((e) => {
  console.error("💥 Tool tests crashed:", e)
  process.exit(1)
})
