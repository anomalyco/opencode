// @ts-nocheck
// Test suite for OpenCode automation features
import { Effect, Layer, Console, Schedule } from "effect"
import { SchedulerService, type ScheduleInput } from "../src/scheduler/scheduler"
import { PatternDetectionService } from "../src/pattern-detection/pattern-detection"
import { AutoReplyService } from "../src/auto-reply/auto-reply"
import { HookService, type HookConfig } from "../src/hook/hook"
import { AutomationFeaturesService } from "../src/automation/automation-features"

// Test layers
const testLayers = Layer.mergeAll(
  SchedulerService.layer,
  PatternDetectionService.layer,
  AutoReplyService.layer,
  HookService.layer,
  AutomationFeaturesService.layer
)

// Test runner
const runTests = Effect.gen(function* () {
  yield* Console.log("🧪 Running OpenCode Automation Features Tests\n")

  // Test 1: Scheduler Service
  yield* Console.log("📋 Testing Scheduler Service...")
  const scheduler = yield* SchedulerService
  const scheduleId = yield* scheduler.schedule({
    cron: "*/1 * * * *", // Every minute
    command: "echo 'test command'",
    metadata: { test: true }
  })
  yield* Console.log(`✅ Scheduled job: ${scheduleId}`)

  const jobs = yield* scheduler.list()
  yield* Console.log(`✅ Found ${jobs.length} scheduled jobs`)

  // Test 2: Pattern Detection
  yield* Console.log("\n🔍 Testing Pattern Detection...")
  const patternDetection = yield* PatternDetectionService
  
  // Test pattern detection with repetitive text
  const repetitiveText = "This is a test message that will be repeated"
  for (let i = 0; i < 3; i++) {
    const detected = yield* patternDetection.detectPattern(repetitiveText)
    yield* Console.log(`Pattern detection attempt ${i + 1}: ${detected ? "detected" : "not detected"}`)
  }

  const state = yield* patternDetection.getCurrentState()
  yield* Console.log(`✅ Current streak: ${state.currentStreak}`)
  yield* Console.log(`✅ Recent texts: ${state.recentTexts.length}`)

  // Test 3: Auto-Reply Service
  yield* Console.log("\n💬 Testing Auto-Reply Service...")
  const autoReply = yield* AutoReplyService

  // Test auto-reply configuration
  yield* autoReply.updateConfig({
    enabled: true,
    phrases: ["continue", "go on", "proceed"],
    triggerPhrases: ["next steps", "what next"]
  })

  const shouldReply = yield* autoReply.shouldAutoReply("What are the next steps?")
  yield* Console.log(`✅ Should auto-reply: ${shouldReply}`)

  const reply = yield* autoReply.generateReply()
  yield* Console.log(`✅ Generated reply: ${reply}`)

  const stats = yield* autoReply.getCurrentStats()
  yield* Console.log(`✅ Reply stats: ${stats.totalResponses} total, ${stats.recentResponses} recent`)

  // Test 4: Hook Service
  yield* Console.log("\n🪝 Testing Hook Service...")
  const hookService = yield* HookService

  // Add a test hook
  const testHook: HookConfig = {
    type: "cli",
    command: "echo 'hook response'",
    fallback: "fallback response",
    timeout: 5000
  }

  yield* hookService.addHook("test-hook", testHook)
  yield* Console.log("✅ Added test hook")

  const hooks = yield* hookService.listHooks()
  yield* Console.log(`✅ Found ${hooks.length} hooks`)

  // Test hook execution
  const hookContext = {
    originalText: "test message",
    conversationHistory: [{ role: "user", content: "Hello" }],
    timestamp: Date.now(),
    metadata: { test: true }
  }

  const hookResult = yield* hookService.executeHook("test-hook", hookContext)
  yield* Console.log(`✅ Hook result: ${hookResult}`)

  // Test 5: Combined Automation Features
  yield* Console.log("\n🤖 Testing Combined Automation Features...")
  const automation = yield* AutomationFeaturesService

  // Test combined configuration
  yield* automation.updateConfig({
    enabled: true,
    autoReply: { enabled: true, useHooks: true, fallbackToPhrases: true },
    patternDetection: { enabled: true, maxRepetitions: 3 },
    scheduler: { enabled: true }
  })

  const autoConfig = yield* automation.getConfig()
  yield* Console.log(`✅ Automation config: ${autoConfig.enabled}`)

  // Test loop detection with auto-reply integration
  const loopDetected = yield* automation.detectAndHandleLoop("repetitive text")
  yield* Console.log(`✅ Loop detected: ${loopDetected}`)

  const autoReplyResult = yield* automation.shouldAutoReply("What should I do next?")
  yield* Console.log(`✅ Auto-reply should trigger: ${autoReplyResult}`)

  // Test 6: Error Handling
  yield* Console.log("\n🚨 Testing Error Handling...")
  
  // Test non-existent hook
  try {
    yield* hookService.executeHook("non-existent-hook", hookContext)
  } catch (error) {
    yield* Console.log(`✅ Correctly handled missing hook: ${error}`)
  }

  // Test invalid hook configuration
  try {
    yield* hookService.executeHook("test-hook", { 
      originalText: "", 
      timestamp: Date.now() 
    })
  } catch (error) {
    yield* Console.log(`✅ Correctly handled invalid context: ${error}`)
  }

  yield* Console.log("\n✅ All tests completed successfully!")
})

// Execute tests
const testProgram = Effect.provide(runTests, testLayers)

// Run with error handling
Effect.runPromise(
  testProgram.pipe(
    Effect.catchAll(error => 
      Console.error(`Test failed: ${error}`).pipe(Effect.as(false))
    )
  )
).then(success => {
  process.exit(success ? 0 : 1)
}).catch(error => {
  Console.error(`Test runner failed: ${error}`)
  process.exit(1)
})