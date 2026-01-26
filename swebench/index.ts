#!/usr/bin/env bun
/**
 * SWE-bench Evaluation Tool
 *
 * Usage:
 *   bun run packages/opencode/script/swebench --model anthropic/claude-sonnet-4-20250514
 *
 * Options:
 *   --dataset    Dataset type: lite, verified, full (default: lite)
 *   --model      Model identifier (provider/model) (required)
 *   --concurrency Concurrency level (default: 3)
 *   --output     Output directory (default: ./swebench-results)
 *   --timeout    Timeout per instance in seconds (default: 600)
 *   --resume     Resume from directory
 *   --limit      Limit number of instances
 *   --instances  Run specific instance IDs only (comma-separated)
 *   --agent      Agent to use (default: build)
 */

import { parseArgs } from "util"
import { run } from "./runner"
import type { RunConfig } from "./types"

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    dataset: {
      type: "string",
      short: "d",
      default: "lite",
    },
    model: {
      type: "string",
      short: "m",
    },
    concurrency: {
      type: "string",
      short: "c",
      default: "3",
    },
    output: {
      type: "string",
      short: "o",
      default: "./swebench/results",
    },
    timeout: {
      type: "string",
      short: "t",
      default: "600",
    },
    resume: {
      type: "string",
      short: "r",
    },
    limit: {
      type: "string",
      short: "l",
    },
    instances: {
      type: "string",
      short: "i",
    },
    agent: {
      type: "string",
      short: "a",
      default: "build",
    },
    help: {
      type: "boolean",
      short: "h",
    },
  },
  allowPositionals: true,
})

function showHelp() {
  console.log(`
SWE-bench Evaluation Tool for opencode

Usage:
  bun run packages/opencode/script/swebench --model <provider/model> [options]

Options:
  -m, --model <model>       Model to use (required), format: provider/model
                            Examples: anthropic/claude-sonnet-4-20250514, openai/gpt-4o
  -d, --dataset <dataset>   Dataset to use: lite, verified, full (default: lite)
  -c, --concurrency <n>     Number of parallel workers (default: 3)
  -o, --output <dir>        Output directory (default: ./swebench-results)
  -t, --timeout <seconds>   Timeout per instance in seconds (default: 600)
  -r, --resume <dir>        Resume from a previous run directory
  -l, --limit <n>           Limit number of instances to process
  -i, --instances <ids>     Only run specific instance IDs (comma-separated)
  -a, --agent <agent>       Agent to use (default: build)
  -h, --help                Show this help message

Examples:
  # Basic usage with Claude
  bun run packages/opencode/script/swebench --model anthropic/claude-sonnet-4-20250514

  # Run with higher concurrency and custom output
  bun run packages/opencode/script/swebench \\
    --model anthropic/claude-sonnet-4-20250514 \\
    --concurrency 5 \\
    --output ./my-results

  # Test with only 10 instances
  bun run packages/opencode/script/swebench \\
    --model anthropic/claude-sonnet-4-20250514 \\
    --limit 10

  # Resume a previous run
  bun run packages/opencode/script/swebench \\
    --model anthropic/claude-sonnet-4-20250514 \\
    --resume ./swebench-results/2026-01-26-abc123

  # Run specific instances
  bun run packages/opencode/script/swebench \\
    --model anthropic/claude-sonnet-4-20250514 \\
    --instances "astropy__astropy-12907,django__django-11039"
`)
}

async function main() {
  if (values.help) {
    showHelp()
    process.exit(0)
  }

  if (!values.model) {
    console.error("Error: --model is required")
    console.error("Run with --help for usage information")
    process.exit(1)
  }

  const dataset = values.dataset as "lite" | "verified" | "full"
  if (!["lite", "verified", "full"].includes(dataset)) {
    console.error(`Error: Invalid dataset "${dataset}". Must be one of: lite, verified, full`)
    process.exit(1)
  }

  const config: RunConfig = {
    dataset,
    model: values.model,
    concurrency: parseInt(values.concurrency || "3", 10),
    outputDir: values.output || "./swebench/results",
    timeout: parseInt(values.timeout || "600", 10) * 1000, // convert to ms
    resume: values.resume,
    limit: values.limit ? parseInt(values.limit, 10) : undefined,
    instances: values.instances ? values.instances.split(",").map((s) => s.trim()) : undefined,
    agent: values.agent || "build",
  }

  // Validate concurrency
  if (config.concurrency < 1 || config.concurrency > 20) {
    console.error("Error: Concurrency must be between 1 and 20")
    process.exit(1)
  }

  // Validate timeout
  if (config.timeout < 60000) {
    console.error("Error: Timeout must be at least 60 seconds")
    process.exit(1)
  }

  try {
    await run(config)
  } catch (error) {
    console.error("\nFatal error:", error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
