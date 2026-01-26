#!/usr/bin/env bun
/**
 * SWE-bench Quick Start - Interactive launcher
 *
 * Run directly:
 *   bun swebench/run.ts
 *
 * Will enter interactive mode to guide configuration.
 */

import * as readline from "readline"
import { run } from "./runner"
import type { RunConfig } from "./types"

const MODELS = [
  { id: "opencode/big-pickle", name: "Big Pickle (Free)" },
  { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4 (Recommended)" },
  { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4" },
  { id: "openai/gpt-4o", name: "GPT-4o" },
  { id: "openai/o1", name: "OpenAI o1" },
  { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  { id: "custom", name: "Custom model..." },
]

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

async function select<T extends { id: string; name: string }>(
  rl: readline.Interface,
  message: string,
  options: T[],
  defaultIndex = 0,
): Promise<T> {
  console.log(`\n${message}`)
  options.forEach((opt, i) => {
    const marker = i === defaultIndex ? ">" : " "
    console.log(`  ${marker} ${i + 1}. ${opt.name}`)
  })

  const answer = await ask(rl, `Select [1-${options.length}] (default ${defaultIndex + 1}): `)
  const index = answer ? parseInt(answer, 10) - 1 : defaultIndex

  if (index >= 0 && index < options.length) {
    return options[index]
  }
  return options[defaultIndex]
}

async function interactiveMode(): Promise<RunConfig> {
  const rl = createPrompt()

  console.log("\n" + "=".repeat(50))
  console.log("  SWE-bench Evaluation Tool")
  console.log("=".repeat(50))

  // Select dataset
  const datasetOptions = [
    { id: "smoke" as const, name: "Smoke Test (2 instances) - Verify environment" },
    { id: "lite" as const, name: "Lite (300 instances) - Quick test, recommended" },
    { id: "verified" as const, name: "Verified (500 instances) - Expert verified" },
    { id: "full" as const, name: "Full (2294 instances) - Complete dataset" },
  ]
  const datasetChoice = await select(rl, "Select dataset:", datasetOptions, 0)
  const isSmoke = datasetChoice.id === "smoke"
  const dataset = isSmoke ? { id: "lite" as const, name: "Lite" } : datasetChoice

  // Select model
  const model = await select(rl, "Select model:", MODELS, 0)

  // Custom model
  let modelId = model.id
  if (model.id === "custom") {
    modelId = await ask(rl, "Enter model ID (format: provider/model): ")
  }

  // Concurrency
  const concurrencyStr = await ask(rl, "\nConcurrency [1-10] (default 3): ")
  const concurrency = concurrencyStr ? Math.min(10, Math.max(1, parseInt(concurrencyStr, 10) || 3)) : 3

  // Limit count (quick test)
  let limit: number | undefined
  if (isSmoke) {
    limit = 2
  } else {
    const limitStr = await ask(rl, "Limit instance count (press Enter for no limit): ")
    limit = limitStr ? parseInt(limitStr, 10) : undefined
  }

  rl.close()

  console.log("\n" + "-".repeat(50))
  console.log("Configuration:")
  console.log(`  Dataset:     ${datasetChoice.name}`)
  console.log(`  Model:       ${modelId}`)
  console.log(`  Concurrency: ${concurrency}`)
  console.log(`  Instances:   ${limit || "All"}`)
  console.log("-".repeat(50) + "\n")

  return {
    dataset: dataset.id,
    model: modelId,
    concurrency,
    outputDir: "./swebench/results",
    timeout: 10 * 60 * 1000, // 10 minutes
    limit,
  }
}

async function quickMode(model?: string): Promise<RunConfig> {
  // Quick mode: use free model + smoke test
  return {
    dataset: "lite",
    model: model || "opencode/big-pickle",
    concurrency: 2,
    outputDir: "./swebench/results",
    timeout: 10 * 60 * 1000,
    limit: 2, // Smoke test
  }
}

async function main() {
  const args = Bun.argv.slice(2)

  // Check for --quick or -q flag
  const quickIndex = args.findIndex((a) => a === "--quick" || a === "-q")
  const modelIndex = args.findIndex((a) => a === "--model" || a === "-m")

  let config: RunConfig

  if (quickIndex !== -1 || (args.includes("--help") === false && args.length > 0 && modelIndex !== -1)) {
    // Quick mode
    const model = modelIndex !== -1 ? args[modelIndex + 1] : undefined
    config = await quickMode(model)
    console.log("\n[Quick Mode]")
    console.log(`  Model: ${config.model}`)
    console.log(`  Dataset: ${config.dataset}`)
    console.log(`  Concurrency: ${config.concurrency}\n`)
  } else if (args.length === 0) {
    // Interactive mode
    config = await interactiveMode()
  } else if (args.includes("--help") || args.includes("-h")) {
    console.log(`
SWE-bench Evaluation Tool

Usage:
  bun swebench/run.ts              Interactive mode (recommended)
  bun swebench/run.ts -q           Quick mode (default config)
  bun swebench/run.ts -m <model>   Quick start with model

Examples:
  bun swebench/run.ts
  bun swebench/run.ts -q
  bun swebench/run.ts -m anthropic/claude-sonnet-4-20250514

Advanced usage (more options):
  bun swebench/index.ts --help
`)
    process.exit(0)
  } else {
    // Pass to full CLI
    const { spawn } = await import("bun")
    const proc = spawn(["bun", "swebench/index.ts", ...args], {
      cwd: process.cwd(),
      stdio: ["inherit", "inherit", "inherit"],
    })
    await proc.exited
    process.exit(proc.exitCode || 0)
  }

  try {
    await run(config)
  } catch (error) {
    console.error("\nError:", error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
