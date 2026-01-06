#!/usr/bin/env bun
/**
 * Standalone benchmark runner for testing compaction methods
 * This script tests the benchmark framework without the full TUI dependencies
 */
import { BenchmarkMetrics } from "./src/benchmark/metrics"
import { RefactorTask } from "./src/benchmark/tasks/refactor"
import fs from "fs/promises"
import path from "path"

const OPENROUTER_API_KEY = "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"
const MODEL = "xiaomi/mimo-v2-flash:free"

interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

async function callOpenRouter(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
  const body: any = {
    model: MODEL,
    messages: systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages,
    temperature: 0.7,
    max_tokens: 4096,
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://opencode.ai",
      "X-Title": "OpenCode Benchmark",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`)
  }

  const data = await response.json() as any
  return data.choices[0].message.content
}

async function simulateCompaction(
  context: string,
  method: "hybrid" | "legacy"
): Promise<BenchmarkMetrics.CompactionMetrics> {
  const startTime = Date.now()
  const originalTokens = Math.ceil(context.length / 4) // Rough estimate

  let prompt: string
  let systemPrompt: string

  if (method === "hybrid") {
    // Hybrid: Use structured extraction prompt
    systemPrompt = `You are a session compaction assistant. Extract key information into a structured format.
Focus on:
- Files read, modified, created
- Errors encountered and their resolution status
- Current task intent and state
- Pending tasks
Be concise but comprehensive.`
    prompt = `Compact this session context into a structured summary:\n\n${context.slice(0, 8000)}`
  } else {
    // Legacy: Use the traditional summarization approach
    systemPrompt = `You are a helpful assistant that summarizes coding conversations.`
    prompt = `Provide a detailed prompt for continuing our conversation. Focus on what we did, what we're doing, which files we're working on, and what we're going to do next:\n\n${context.slice(0, 8000)}`
  }

  try {
    const output = await callOpenRouter([{ role: "user", content: prompt }], systemPrompt)
    const duration = Date.now() - startTime
    const compactedTokens = Math.ceil(output.length / 4)

    return {
      method,
      timestamp: startTime,
      duration_ms: duration,
      tokens: {
        input: Math.ceil(prompt.length / 4),
        output: compactedTokens,
        total: Math.ceil(prompt.length / 4) + compactedTokens,
      },
      original_context_tokens: originalTokens,
      compacted_context_tokens: compactedTokens,
      compression_ratio: 1 - (compactedTokens / originalTokens),
      output_text: output,
    }
  } catch (error) {
    console.error(`Error in ${method} compaction:`, error)
    return {
      method,
      timestamp: startTime,
      duration_ms: Date.now() - startTime,
      tokens: { input: 0, output: 0, total: 0 },
      original_context_tokens: originalTokens,
      compacted_context_tokens: 0,
      compression_ratio: 0,
      output_text: `Error: ${error instanceof Error ? error.message : error}`,
    }
  }
}

async function runBenchmark() {
  console.log("╔════════════════════════════════════════════════════╗")
  console.log("║     OpenCode Compaction Benchmark                  ║")
  console.log("╚════════════════════════════════════════════════════╝")
  console.log()
  console.log(`Model: ${MODEL}`)
  console.log(`Task: refactor`)
  console.log()

  const benchmarkId = BenchmarkMetrics.generateBenchmarkId()

  // Setup task
  console.log("📁 Setting up benchmark task...")
  const taskDir = await RefactorTask.setup()
  console.log(`   Created: ${taskDir}`)

  // Create a simulated session context (what the compaction would receive)
  const sessionContext = `
## Session Context for Compaction

### User Request
${RefactorTask.TASK_PROMPT}

### Files Read
- src/index.ts: Main entry point importing getData from api/data
- src/api/data.ts: Contains getData function for fetching users
- src/services/user.ts: User processing service using validateEmail
- src/utils/helpers.ts: Validation helpers (validateEmail, validateAge, validateName)
- tsconfig.json: TypeScript configuration

### Tool Calls Made
1. Read src/index.ts - SUCCESS
2. Read src/api/data.ts - SUCCESS
3. Read src/services/user.ts - SUCCESS
4. Read src/utils/helpers.ts - SUCCESS
5. Edit src/api/data.ts - Changed getData to fetchUserData - SUCCESS
6. Edit src/index.ts - Updated import to fetchUserData - SUCCESS
7. Write src/utils/validation.ts - Created new validation module - SUCCESS
8. Edit src/utils/helpers.ts - Removed validation functions - SUCCESS

### Errors Encountered
- TypeError: Cannot read property 'email' of undefined at line 15 - RESOLVED by adding null check
- Import error: Module not found './validation' - RESOLVED by creating the file

### Current State
- Renamed getData to fetchUserData across all files
- Created utils/validation.ts with extracted validation functions
- Updated imports in index.ts and services/user.ts
- Added TypeScript interfaces for User type

### Pending Tasks
- Add try-catch blocks for error handling
- Run TypeScript compilation to verify changes
- Update remaining files with proper types
`

  // Run hybrid compaction
  console.log()
  console.log("🔄 Running HYBRID compaction...")
  const hybridMetrics = await simulateCompaction(sessionContext, "hybrid")
  console.log(`   Duration: ${hybridMetrics.duration_ms}ms`)
  console.log(`   Tokens: ${hybridMetrics.tokens.total} (in: ${hybridMetrics.tokens.input}, out: ${hybridMetrics.tokens.output})`)
  console.log(`   Compression: ${(hybridMetrics.compression_ratio * 100).toFixed(1)}%`)

  // Run legacy compaction
  console.log()
  console.log("🔄 Running LEGACY compaction...")
  const legacyMetrics = await simulateCompaction(sessionContext, "legacy")
  console.log(`   Duration: ${legacyMetrics.duration_ms}ms`)
  console.log(`   Tokens: ${legacyMetrics.tokens.total} (in: ${legacyMetrics.tokens.input}, out: ${legacyMetrics.tokens.output})`)
  console.log(`   Compression: ${(legacyMetrics.compression_ratio * 100).toFixed(1)}%`)

  // Create run metrics
  const hybridRun: BenchmarkMetrics.RunMetrics = {
    run_id: BenchmarkMetrics.generateRunId("hybrid"),
    task: "refactor",
    model: MODEL,
    started_at: hybridMetrics.timestamp,
    completed_at: hybridMetrics.timestamp + hybridMetrics.duration_ms,
    total_compactions: 1,
    compactions: [hybridMetrics],
    task_completed: true,
  }

  const legacyRun: BenchmarkMetrics.RunMetrics = {
    run_id: BenchmarkMetrics.generateRunId("legacy"),
    task: "refactor",
    model: MODEL,
    started_at: legacyMetrics.timestamp,
    completed_at: legacyMetrics.timestamp + legacyMetrics.duration_ms,
    total_compactions: 1,
    compactions: [legacyMetrics],
    task_completed: true,
  }

  // Compare
  const comparison = BenchmarkMetrics.compareRuns(hybridRun, legacyRun)

  // Build result
  const result: BenchmarkMetrics.BenchmarkResult = {
    benchmark_id: benchmarkId,
    task: "refactor",
    model: `openrouter/${MODEL}`,
    timestamp: Date.now(),
    hybrid: hybridRun,
    legacy: legacyRun,
    comparison,
  }

  // Save results
  const outputDir = "./benchmark-results"
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${benchmarkId}.json`)
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2))

  // Cleanup
  await RefactorTask.cleanup(taskDir)

  // Print results
  console.log()
  console.log("╔════════════════════════════════════════════════════╗")
  console.log("║                    RESULTS                         ║")
  console.log("╚════════════════════════════════════════════════════╝")
  console.log()
  console.log("┌─────────────────┬─────────────┬─────────────┐")
  console.log("│ Metric          │ Hybrid      │ Legacy      │")
  console.log("├─────────────────┼─────────────┼─────────────┤")
  console.log(`│ Duration        │ ${String(hybridMetrics.duration_ms + "ms").padEnd(11)} │ ${String(legacyMetrics.duration_ms + "ms").padEnd(11)} │`)
  console.log(`│ Total Tokens    │ ${String(hybridMetrics.tokens.total).padEnd(11)} │ ${String(legacyMetrics.tokens.total).padEnd(11)} │`)
  console.log(`│ Compression     │ ${String((hybridMetrics.compression_ratio * 100).toFixed(1) + "%").padEnd(11)} │ ${String((legacyMetrics.compression_ratio * 100).toFixed(1) + "%").padEnd(11)} │`)
  console.log("└─────────────────┴─────────────┴─────────────┘")
  console.log()
  console.log("📊 Comparison:")
  console.log(`   Token savings:  ${comparison.token_savings_percent >= 0 ? "+" : ""}${comparison.token_savings_percent.toFixed(1)}%`)
  console.log(`   Time savings:   ${comparison.time_savings_percent >= 0 ? "+" : ""}${comparison.time_savings_percent.toFixed(1)}%`)
  console.log(`   Winner:         🏆 ${comparison.winner?.toUpperCase()}`)
  console.log()
  console.log(`💾 Results saved to: ${outputPath}`)
  console.log()

  // Print compaction outputs
  console.log("═══════════════════════════════════════════════════════")
  console.log("HYBRID OUTPUT:")
  console.log("═══════════════════════════════════════════════════════")
  console.log(hybridMetrics.output_text)
  console.log()
  console.log("═══════════════════════════════════════════════════════")
  console.log("LEGACY OUTPUT:")
  console.log("═══════════════════════════════════════════════════════")
  console.log(legacyMetrics.output_text)

  return result
}

// Run the benchmark
runBenchmark().catch(console.error)
