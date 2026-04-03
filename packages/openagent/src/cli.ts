#!/usr/bin/env bun
/**
 * OpenAgent CLI
 *
 * Run OpenAgent as a standalone service or send a one-off task.
 *
 * Usage:
 *   # Start server
 *   bun run src/cli.ts serve --port 3000
 *
 *   # Run a task directly
 *   bun run src/cli.ts run "Fix all TypeScript errors in the codebase"
 *
 *   # Run a task with high priority
 *   bun run src/cli.ts run "Critical production bug: payments failing" --priority critical
 */

import { createOpenAgent } from "./index.ts"

const [, , command, ...args] = process.argv

async function main() {
  if (!command || command === "help") {
    printHelp()
    process.exit(0)
  }

  if (command === "serve") {
    const port = getFlag(args, "--port", "3000")
    const model = getFlag(args, "--model", "claude-sonnet-4-6")

    console.log("🤖 Starting OpenAgent...")
    console.log(`   Model: ${model}`)
    console.log(`   Port:  ${port}`)

    const agent = await createOpenAgent({
      port: parseInt(port),
      orchestrator: { model },
    })

    console.log(`\n✅ OpenAgent running at ${agent.url}`)
    console.log(`   OpenCode engine at ${agent.opencodeUrl}`)
    console.log(`\nEndpoints:`)
    console.log(`   POST ${agent.url}/tasks              Submit task (async)`)
    console.log(`   POST ${agent.url}/tasks/sync         Submit task (sync, wait for result)`)
    console.log(`   GET  ${agent.url}/tasks              List all tasks`)
    console.log(`   GET  ${agent.url}/tasks/:id          Get task status`)
    console.log(`   GET  ${agent.url}/tasks/:id/stream   SSE stream for task progress`)
    console.log(`   POST ${agent.url}/github/webhook     GitHub webhook endpoint`)
    console.log(`   GET  ${agent.url}/pool/stats         Session pool stats`)
    console.log(`   GET  ${agent.url}/health             Health check`)

    // Keep alive
    process.on("SIGINT", () => {
      console.log("\n🛑 Shutting down OpenAgent...")
      agent.close()
      process.exit(0)
    })
    return
  }

  if (command === "run") {
    const description = args.filter((a) => !a.startsWith("--")).join(" ")
    if (!description) {
      console.error("Error: provide a task description")
      process.exit(1)
    }

    const priority = getFlag(args, "--priority", "normal") as any
    const model = getFlag(args, "--model", "claude-sonnet-4-6")

    console.log(`🤖 OpenAgent: ${description}`)
    console.log(`   Priority: ${priority} | Model: ${model}\n`)

    const controller = new AbortController()
    process.on("SIGINT", () => controller.abort())

    const agent = await createOpenAgent({
      orchestrator: { model },
      signal: controller.signal,
    })

    try {
      const result = await agent.run(description, { priority })
      console.log("\n─────────────────────────────────────────────")
      console.log("Result:\n")
      console.log(result)
    } finally {
      agent.close()
    }
    return
  }

  console.error(`Unknown command: ${command}`)
  printHelp()
  process.exit(1)
}

function getFlag(args: string[], flag: string, defaultValue: string): string {
  const idx = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`))
  if (idx === -1) return defaultValue
  const arg = args[idx]
  if (arg.includes("=")) return arg.split("=")[1]
  return args[idx + 1] ?? defaultValue
}

function printHelp() {
  console.log(`
OpenAgent — Meta-orchestrator for OpenCode

Usage:
  openagent serve [--port <port>] [--model <model>]
  openagent run <description> [--priority low|normal|high|critical] [--model <model>]
  openagent help

Commands:
  serve    Start the OpenAgent HTTP API server
  run      Execute a single task and print the result

Examples:
  openagent serve --port 3000
  openagent run "Add pagination to the users API endpoint"
  openagent run "Fix the failing tests in packages/opencode" --priority high
`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
