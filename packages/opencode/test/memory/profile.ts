#!/usr/bin/env bun
/**
 * Memory Profiling Script for OpenCode
 *
 * This script simulates subscription lifecycle patterns and monitors memory usage
 * to verify that memory leaks have been fixed.
 *
 * Usage:
 *   bun run test/memory/profile.ts
 *
 * For heap snapshots (requires --expose-gc flag):
 *   bun --expose-gc run test/memory/profile.ts
 */

import { Log } from "../../src/util/log"

Log.init({ print: false, dev: false, level: "ERROR" })

interface MemorySnapshot {
  label: string
  heapUsed: number
  heapTotal: number
  external: number
  rss: number
  timestamp: number
}

function takeSnapshot(label: string): MemorySnapshot {
  const mem = process.memoryUsage()
  return {
    label,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    rss: mem.rss,
    timestamp: Date.now(),
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function printSnapshot(snapshot: MemorySnapshot) {
  console.log(`[${snapshot.label}]`)
  console.log(`  Heap Used:  ${formatBytes(snapshot.heapUsed)}`)
  console.log(`  Heap Total: ${formatBytes(snapshot.heapTotal)}`)
  console.log(`  RSS:        ${formatBytes(snapshot.rss)}`)
}

function compareSnapshots(before: MemorySnapshot, after: MemorySnapshot) {
  const heapDiff = after.heapUsed - before.heapUsed
  const rssDiff = after.rss - before.rss
  console.log(`\n[Delta: ${before.label} -> ${after.label}]`)
  console.log(`  Heap Used:  ${heapDiff >= 0 ? "+" : ""}${formatBytes(heapDiff)}`)
  console.log(`  RSS:        ${rssDiff >= 0 ? "+" : ""}${formatBytes(rssDiff)}`)
  return { heapDiff, rssDiff }
}

function forceGC() {
  if (global.gc) {
    global.gc()
    console.log("  (GC forced)")
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

// ============================================================================
// Test Scenarios
// ============================================================================

async function testShareSubscriptionCycles() {
  console.log("\n" + "=".repeat(60))
  console.log("TEST: Share subscription init/dispose cycles")
  console.log("=".repeat(60))

  const { Share } = await import("../../src/share/share")

  forceGC()
  await sleep(100)
  const baseline = takeSnapshot("Baseline")
  printSnapshot(baseline)

  const iterations = 1000
  console.log(`\nRunning ${iterations} init/dispose cycles...`)

  for (let i = 0; i < iterations; i++) {
    Share.init()
    Share.dispose()
    if (i % 100 === 0 && i > 0) {
      process.stdout.write(`  ${i} cycles completed\r`)
    }
  }
  console.log(`  ${iterations} cycles completed`)

  forceGC()
  await sleep(100)
  const afterCycles = takeSnapshot("After cycles")
  printSnapshot(afterCycles)

  const result = compareSnapshots(baseline, afterCycles)

  // Check for leaks (should be less than 1MB growth for 1000 cycles)
  if (result.heapDiff > 1024 * 1024) {
    console.log("\n⚠️  WARNING: Potential memory leak detected!")
    return false
  }
  console.log("\n✅ PASS: Memory stable after subscription cycles")
  return true
}

async function testShareNextSubscriptionCycles() {
  console.log("\n" + "=".repeat(60))
  console.log("TEST: ShareNext subscription init/dispose cycles")
  console.log("=".repeat(60))

  const { ShareNext } = await import("../../src/share/share-next")

  forceGC()
  await sleep(100)
  const baseline = takeSnapshot("Baseline")
  printSnapshot(baseline)

  const iterations = 1000
  console.log(`\nRunning ${iterations} init/dispose cycles...`)

  for (let i = 0; i < iterations; i++) {
    await ShareNext.init()
    ShareNext.dispose()
    if (i % 100 === 0 && i > 0) {
      process.stdout.write(`  ${i} cycles completed\r`)
    }
  }
  console.log(`  ${iterations} cycles completed`)

  forceGC()
  await sleep(100)
  const afterCycles = takeSnapshot("After cycles")
  printSnapshot(afterCycles)

  const result = compareSnapshots(baseline, afterCycles)

  if (result.heapDiff > 1024 * 1024) {
    console.log("\n⚠️  WARNING: Potential memory leak detected!")
    return false
  }
  console.log("\n✅ PASS: Memory stable after subscription cycles")
  return true
}

async function testFormatSubscriptionCycles() {
  console.log("\n" + "=".repeat(60))
  console.log("TEST: Format subscription init/dispose cycles")
  console.log("=".repeat(60))

  const { Format } = await import("../../src/format")

  forceGC()
  await sleep(100)
  const baseline = takeSnapshot("Baseline")
  printSnapshot(baseline)

  const iterations = 1000
  console.log(`\nRunning ${iterations} init/dispose cycles...`)

  for (let i = 0; i < iterations; i++) {
    Format.init()
    Format.dispose()
    if (i % 100 === 0 && i > 0) {
      process.stdout.write(`  ${i} cycles completed\r`)
    }
  }
  console.log(`  ${iterations} cycles completed`)

  forceGC()
  await sleep(100)
  const afterCycles = takeSnapshot("After cycles")
  printSnapshot(afterCycles)

  const result = compareSnapshots(baseline, afterCycles)

  if (result.heapDiff > 1024 * 1024) {
    console.log("\n⚠️  WARNING: Potential memory leak detected!")
    return false
  }
  console.log("\n✅ PASS: Memory stable after subscription cycles")
  return true
}

async function testACPControllerCleanup() {
  console.log("\n" + "=".repeat(60))
  console.log("TEST: ACP Agent controller cleanup")
  console.log("=".repeat(60))

  const { ACP } = await import("../../src/acp/agent")

  const mockConnection = {}
  const mockConfig = {
    sdk: {
      event: { subscribe: async () => ({ stream: (async function* () {})() }) },
      permission: { reply: async () => {} },
      session: { message: async () => ({ data: null }), abort: async () => {} },
    },
  }

  forceGC()
  await sleep(100)
  const baseline = takeSnapshot("Baseline")
  printSnapshot(baseline)

  const iterations = 1000
  console.log(`\nCreating and cleaning up ${iterations} sessions...`)

  // @ts-expect-error - testing with mocks
  const agent = new ACP.Agent(mockConnection, mockConfig)

  for (let i = 0; i < iterations; i++) {
    // Simulate session creation with abort controller
    // @ts-expect-error - accessing private for testing
    const controllers = agent.sessionAbortControllers
    controllers.set(`session-${i}`, new AbortController())

    // Clean it up
    // @ts-expect-error - accessing private for testing
    agent.cleanupSession(`session-${i}`)

    if (i % 100 === 0 && i > 0) {
      process.stdout.write(`  ${i} sessions cleaned\r`)
    }
  }
  console.log(`  ${iterations} sessions cleaned`)

  agent.dispose()

  forceGC()
  await sleep(100)
  const afterCycles = takeSnapshot("After cycles")
  printSnapshot(afterCycles)

  const result = compareSnapshots(baseline, afterCycles)

  if (result.heapDiff > 1024 * 1024) {
    console.log("\n⚠️  WARNING: Potential memory leak detected!")
    return false
  }
  console.log("\n✅ PASS: Memory stable after controller cleanup cycles")
  return true
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("OpenCode Memory Profiling")
  console.log("=".repeat(60))
  console.log(`GC Available: ${global.gc ? "Yes" : "No (run with --expose-gc for accurate results)"}`)
  console.log(`Platform: ${process.platform}`)
  console.log(`Bun Version: ${Bun.version}`)

  const results: boolean[] = []

  try {
    results.push(await testShareSubscriptionCycles())
    results.push(await testShareNextSubscriptionCycles())
    results.push(await testFormatSubscriptionCycles())
    results.push(await testACPControllerCleanup())
  } catch (err) {
    console.error("\nError during profiling:", err)
    process.exit(1)
  }

  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))

  const passed = results.filter(Boolean).length
  const total = results.length

  console.log(`Tests passed: ${passed}/${total}`)

  if (passed === total) {
    console.log("\n✅ All memory tests passed!")
    process.exit(0)
  } else {
    console.log("\n❌ Some memory tests failed!")
    process.exit(1)
  }
}

main()
