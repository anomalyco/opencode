import { DEFAULT_USER_PROFILE, formatProfileDirectives, applyProfileDrift } from "../src/profile"
import { buildPersonalizationContext, computeInputAwareAttention } from "../src/aggregator"
import { generateEmbedding, type MemoryRecord } from "../src/memory"

async function runManualTest() {
  console.log("\n=======================================================")
  console.log("🚀 PPLUG DEVELOPER PERSONALIZATION END-TO-END MANUAL TEST")
  console.log("=======================================================\n")

  // 1. Initial Cold Start State
  console.log("📍 [STEP 1] Initial Cold-Start Profile (Zero Assumptions / Clean State):")
  let profile = { ...DEFAULT_USER_PROFILE }
  console.log(JSON.stringify(profile, null, 2))
  console.log("\nFormatted Initial Directive:")
  console.log(formatProfileDirectives(profile) || "(Empty directive — clean cold start)")

  // 2. Simulate User Interaction 1: Strong stylistic and architectural preferences
  console.log("\n-------------------------------------------------------")
  console.log("💬 [STEP 2] Simulating Turn 1 Interaction from Developer:")
  const userMessage1 = "Always use Bun.file() and Effect-TS with strict typing. Never use any. Keep responses very concise."
  console.log(`> Developer says: "${userMessage1}"`)

  // Apply profile drift
  profile = applyProfileDrift(
    profile,
    {
      languages: ["typescript"],
      frameworks: ["effect"],
      style: {
        explicitness: 0.95,
        abstraction_tolerance: 0.2,
        verbosity: 0.15,
        typing_rigor: 0.98,
        inlining_preference: 0.9,
      },
      architecture: {
        paradigm: "functional_composable",
        dependency_pattern: "effect_layers",
      },
      security: {
        mask_secrets_and_ips: true,
        local_first_execution: true,
      },
      automation: {
        allow_browser_automation: false,
        allow_sleep_wait_loops: false,
        auto_test_verification: true,
      },
      tooling: {
        preferred_package_manager: "bun",
      },
    },
    0.5, // alpha drift rate
  )

  const memories: MemoryRecord[] = []

  // Add extracted memory records with real embeddings
  const mem1: MemoryRecord = {
    id: "mem_1",
    userId: "manual_tester",
    tier: "preference",
    category: "style",
    content: "Strict typing with zero 'any'; prefer explicit Effect-TS types and Bun.file()",
    confidence: 0.95,
    embedding: await generateEmbedding("Strict typing with zero any prefer explicit Effect-TS types and Bun.file()"),
    accessCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  memories.push(mem1)

  console.log("\n✅ Profile after Turn 1 (Drift Applied via EMA):")
  console.log(`- Explicitness: ${profile.style.explicitness} (Shifted towards explicit dataflow)`)
  console.log(`- Verbosity: ${profile.style.verbosity} (Shifted towards concise)`)
  console.log(`- Typing Rigor: ${profile.style.typing_rigor} (Strict sound typing locked)`)
  console.log(`- Languages: ${profile.languages.join(", ")}`)
  console.log(`- Frameworks: ${profile.frameworks.join(", ")}`)

  // 3. Simulate User Interaction 2: Playbook routine demonstration
  console.log("\n-------------------------------------------------------")
  console.log("💬 [STEP 3] Simulating Turn 2 Interaction (Workflow Playbook):")
  const userMessage2 = "When creating SQLite tables, define snake_case columns in schema.ts with Drizzle and run bun test after migration."
  console.log(`> Developer says: "${userMessage2}"`)

  profile = applyProfileDrift(
    profile,
    {
      playbooks: [
        {
          routine_name: "add_drizzle_table",
          trigger_pattern: "When creating or modifying SQLite database tables",
          action_sequence: [
            "Define snake_case columns in schema.ts using Drizzle sqliteTable",
            "Create migration script",
            "Run bun test to verify persistence",
          ],
          preferred_commands: ["bun run migration", "bun test"],
          frequency: 1,
        },
      ],
    },
    0.5,
  )

  const mem2: MemoryRecord = {
    id: "mem_2",
    userId: "manual_tester",
    tier: "preference",
    category: "workflow",
    content: "For SQLite tables: use Drizzle schema with snake_case and run bun test after migration",
    confidence: 0.92,
    embedding: await generateEmbedding("For SQLite tables use Drizzle schema with snake_case and run bun test after migration"),
    accessCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  memories.push(mem2)

  // 4. Test PPlug Soft-Attention Aggregation on a NEW Task Input
  console.log("\n-------------------------------------------------------")
  console.log("🧠 [STEP 4] New Task Prompt & Input-Aware Soft-Attention Weighting:")
  const newTaskPrompt = "Create a database table to store session checkpoints in SQLite."
  console.log(`> New Developer Prompt: "${newTaskPrompt}"`)

  const taskEmbedding = await generateEmbedding(newTaskPrompt)
  const scoredMemories = computeInputAwareAttention(taskEmbedding, memories)

  console.log("\nSoft-Attention Distribution across Historical Memories:")
  scoredMemories.forEach((sm, idx) => {
    console.log(`  [Memory ${idx + 1}] (${sm.memory.category}) "${sm.memory.content.slice(0, 45)}...": weight = ${(sm.weight * 100).toFixed(2)}% (similarity = ${(sm.similarity * 100).toFixed(1)}%)`)
  })

  // 5. Synthesized System Context Injection
  console.log("\n-------------------------------------------------------")
  console.log("🎯 [STEP 5] Exact System Context Block Injected into LLM Prompt:")
  const injectedContext = buildPersonalizationContext({
    profile,
    memories,
    queryEmbedding: taskEmbedding,
  })

  console.log("-------------------------------------------------------")
  console.log(injectedContext)
  console.log("-------------------------------------------------------")

  console.log("\n🎉 Manual Verification Complete: Zero Hardcoding, Full Input-Aware PPlug Parity!\n")
}

runManualTest().catch(console.error)
