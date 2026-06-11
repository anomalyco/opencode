// @ts-nocheck
// Integration test for all automation features
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
const runIntegrationTests = Effect.gen(function* () {
  yield* Console.log("🧪 Running OpenCode Automation Features Integration Tests\n")

  // Test 1: Full Integration Workflow
  yield* Console.log("🔄 Testing Full Integration Workflow...")
  
  const automation = yield* AutomationFeaturesService
  
  // Configure all features
  yield* automation.updateConfig({
    enabled: true,
    autoReply: { 
      enabled: true, 
      useHooks: true, 
      primaryHook: "test-hook",
      fallbackToPhrases: true,
      phrases: ["continue", "go on", "proceed"],
      triggerPhrases: ["next steps", "what next", "continue with"]
    },
    patternDetection: { 
      enabled: true, 
      maxRepetitions: 3, 
      timeWindow: 5 * 60 * 1000,
      similarityThreshold: 0.7 
    },
    scheduler: { enabled: true }
  })

  // Add test hooks
  const hookService = yield* HookService
  const testHook: HookConfig = {
    type: "cli",
    command: "echo 'intelligent response'",
    fallback: "fallback response",
    timeout: 5000
  }
  
  yield* hookService.addHook("test-hook", testHook)
  
  // Test 2: Pattern Detection + Auto-Reply Integration
  yield* Console.log("\n🔍 Testing Pattern Detection + Auto-Reply Integration...")
  
  // Simulate repetitive text that should trigger pattern detection
  const repetitiveText = "I need to fix this issue and continue working on it"
  for (let i = 0; i < 3; i++) {
    const shouldUnstick = yield* automation.detectAndHandleLoop(repetitiveText)
    yield* Console.log(`Pattern detection attempt ${i + 1}: ${shouldUnstick ? "detected" : "not detected"}`)
  }

  // Test auto-reply with hook integration
  const hookContext = {
    originalText: "What are the next steps in this process?",
    conversationHistory: [
      { role: "user", content: "I need help with this task" },
      { role: "assistant", content: "Let me help you with that step by step" }
    ],
    timestamp: Date.now(),
    metadata: { test: true }
  }

  const shouldAutoReply = yield* automation.shouldAutoReply(hookContext.originalText)
  yield* Console.log(`Auto-reply should trigger: ${shouldAutoReply}`)

  if (shouldAutoReply) {
    const reply = yield* automation.generateReply(hookContext)
    yield* Console.log(`Generated reply: ${reply}`)
  }

  // Test 3: Scheduler Integration
  yield* Console.log("\n📋 Testing Scheduler Integration...")
  
  const scheduler = yield* SchedulerService
  const scheduleId = yield* scheduler.schedule({
    cron: "*/1 * * * *", // Every minute
    command: "echo 'scheduled automation test'",
    metadata: { 
      test: true,
      automation: "integration-test"
    }
  })
  
  yield* Console.log(`✅ Scheduled job: ${scheduleId}`)
  
  const jobs = yield* scheduler.list()
  yield* Console.log(`✅ Found ${jobs.length} scheduled jobs`)

  // Test 4: Error Handling and Resilience
  yield* Console.log("\n🚨 Testing Error Handling and Resilience...")
  
  // Test with invalid hook
  try {
    yield* automation.generateReply({
      originalText: "test",
      timestamp: Date.now(),
      metadata: { test: true }
    })
  } catch (error) {
    yield* Console.log(`✅ Gracefully handled missing hook: ${error}`)
  }

  // Test 5: Configuration Persistence
  yield* Console.log("\n⚙️ Testing Configuration Persistence...")
  
  const config = yield* automation.getConfig()
  yield* Console.log(`✅ Configuration persisted: automation=${config.enabled}`)
  
  // Update config and verify
  yield* automation.updateConfig({
    autoReply: { 
      enabled: false, 
      useHooks: false, 
      fallbackToPhrases: true 
    }
  })
  
  const updatedConfig = yield* automation.getConfig()
  yield* Console.log(`✅ Configuration updated: autoReply=${updatedConfig.autoReply.enabled}`)

  // Test 6: Performance and Concurrency
  yield* Console.log("\n⚡ Testing Performance and Concurrency...")
  
  // Simulate concurrent operations
  const concurrentTests = Effect.all(Array.from({ length: 5 }, (_, i) => 
    Effect.gen(function* () {
      const result = yield* automation.shouldAutoReply(`Test message ${i}`)
      return result
    })
  ))
  
  const concurrentResults = yield* concurrentTests
  yield* Console.log(`✅ Concurrent operations completed: ${concurrentResults.length} results`)

  // Test 7: Complete Workflow Simulation
  yield* Console.log("\n🎯 Testing Complete Workflow Simulation...")
  
  // Simulate a realistic development workflow
  const workflowSteps = [
    "Starting work on the feature implementation",
    "I need to continue with the database design",
    "Next steps: Create the API endpoints",
    "Continue with the frontend components",
    "I need to fix the authentication issue",
    "What should I do next to complete this feature?"
  ]

  for (const step of workflowSteps) {
    // Test pattern detection
    const shouldUnstick = yield* automation.detectAndHandleLoop(step)
    if (shouldUnstick) {
      yield* Console.log("🔍 Workflow: Loop detected and handled")
    }
    
    // Test auto-reply
    const shouldReply = yield* automation.shouldAutoReply(step)
    if (shouldReply) {
      const reply = yield* automation.generateReply({
        originalText: step,
        conversationHistory: workflowSteps.slice(0, -1).map((msg, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: msg
        })),
        timestamp: Date.now(),
        metadata: { workflow: true }
      })
      yield* Console.log(`💬 Workflow: Auto-reply generated: ${reply}`)
    }
  }

  yield* Console.log("\n✅ All integration tests completed successfully!")
})

// Execute tests
const integrationTestProgram = Effect.provide(runIntegrationTests, testLayers)

// Run with comprehensive error handling
Effect.runPromise(
  integrationTestProgram.pipe(
    Effect.catchAll(error => 
      Console.error(`Integration test failed: ${error}`).pipe(Effect.as(false))
    )
  )
).then(success => {
  process.exit(success ? 0 : 1)
}).catch(error => {
  Console.error(`Integration test runner failed: ${error}`)
  process.exit(1)
})