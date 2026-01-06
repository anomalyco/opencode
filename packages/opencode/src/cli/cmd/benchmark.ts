import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { BenchmarkRunner, BenchmarkMetrics, CompactionJudge, AVAILABLE_TASKS, getTask, type TaskName } from "../../benchmark"
import { EOL } from "os"

export const BenchmarkCommand = cmd({
  command: "benchmark [task]",
  describe: "run compaction benchmark comparing hybrid vs legacy methods",
  builder: (yargs: Argv) => {
    return yargs
      .positional("task", {
        describe: "benchmark task to run",
        type: "string",
        default: "refactor",
        choices: AVAILABLE_TASKS,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
        demandOption: true,
      })
      .option("output", {
        type: "string",
        alias: ["o"],
        default: "./benchmark-results",
        describe: "output directory for results",
      })
      .option("judge", {
        type: "boolean",
        alias: ["j"],
        default: false,
        describe: "run async LLM judgment after completion",
      })
      .option("list", {
        type: "boolean",
        alias: ["l"],
        describe: "list available benchmark tasks",
      })
      .option("results", {
        type: "string",
        alias: ["r"],
        describe: "path to results file to display",
      })
  },
  handler: async (args) => {
    // Handle --list
    if (args.list) {
      UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Available benchmark tasks:" + UI.Style.RESET)
      UI.println()
      for (const task of AVAILABLE_TASKS) {
        UI.println(`  ${UI.Style.TEXT_INFO_BOLD}${task}${UI.Style.RESET}`)
      }
      return
    }

    // Handle --results
    if (args.results) {
      const result = await BenchmarkRunner.loadResults(args.results)
      if (!result) {
        UI.error(`Could not load results from ${args.results}`)
        process.exit(1)
      }
      printResults(result)
      return
    }

    await bootstrap(process.cwd(), async () => {
      const taskName = args.task as TaskName
      const task = await getTask(taskName)

      UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Opencode Compaction Benchmark" + UI.Style.RESET)
      UI.println()
      UI.println(`Task:   ${UI.Style.TEXT_INFO_BOLD}${taskName}${UI.Style.RESET}`)
      UI.println(`Model:  ${UI.Style.TEXT_INFO_BOLD}${args.model}${UI.Style.RESET}`)
      UI.println(`Output: ${UI.Style.TEXT_DIM}${args.output}${UI.Style.RESET}`)
      UI.println()

      // Set up the task
      UI.println(UI.Style.TEXT_DIM + "Setting up benchmark task..." + UI.Style.RESET)
      const taskDir = await task.setup()
      UI.println(UI.Style.TEXT_SUCCESS + "Task directory created: " + UI.Style.TEXT_DIM + taskDir + UI.Style.RESET)
      UI.println()

      try {
        // Run the benchmark
        UI.println(UI.Style.TEXT_WARNING_BOLD + "Running benchmark..." + UI.Style.RESET)
        UI.println(UI.Style.TEXT_DIM + "This may take several minutes depending on the task complexity." + UI.Style.RESET)
        UI.println()

        const result = await BenchmarkRunner.run({
          task: task.prompt,
          model: args.model!,
          outputDir: args.output!,
          runJudge: args.judge,
        })

        // Print results
        printResults(result)

        // Run LLM judge if requested
        if (args.judge) {
          UI.println()
          UI.println(UI.Style.TEXT_WARNING_BOLD + "Running LLM judge evaluation..." + UI.Style.RESET)
          const judgedResult = await CompactionJudge.judgeAndUpdate(result, args.model!)
          if (judgedResult.llm_judgment) {
            UI.println()
            UI.println(UI.Style.TEXT_INFO_BOLD + "LLM Judgment:" + UI.Style.RESET)
            const winnerStyle = judgedResult.llm_judgment.winner === "hybrid"
              ? UI.Style.TEXT_SUCCESS_BOLD
              : judgedResult.llm_judgment.winner === "legacy"
                ? UI.Style.TEXT_WARNING_BOLD
                : UI.Style.TEXT_DIM
            UI.println(`  Winner:    ${winnerStyle}${judgedResult.llm_judgment.winner.toUpperCase()}${UI.Style.RESET}`)
            UI.println(`  Rationale: ${judgedResult.llm_judgment.rationale}`)

            // Update the saved results with judgment
            const fs = await import("fs/promises")
            const path = await import("path")
            const filepath = path.join(args.output!, `${result.benchmark_id}.json`)
            await fs.writeFile(filepath, JSON.stringify(judgedResult, null, 2))
            UI.println(UI.Style.TEXT_DIM + `Results updated with judgment.` + UI.Style.RESET)
          }
        }

        // Verify task completion if available
        if (task.verify) {
          UI.println()
          UI.println(UI.Style.TEXT_INFO_BOLD + "Verifying task completion..." + UI.Style.RESET)
          const verification = await task.verify(taskDir)
          if (verification.success) {
            UI.println(UI.Style.TEXT_SUCCESS + "Task verification passed!" + UI.Style.RESET)
          } else {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "Task verification failed:" + UI.Style.RESET)
            for (const issue of verification.issues) {
              UI.println(UI.Style.TEXT_WARNING + `  - ${issue}` + UI.Style.RESET)
            }
          }
        }
      } finally {
        // Clean up
        UI.println()
        UI.println(UI.Style.TEXT_DIM + "Cleaning up..." + UI.Style.RESET)
        await task.cleanup(taskDir)
      }
    })
  },
})

function printResults(result: BenchmarkMetrics.BenchmarkResult) {
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Benchmark Results" + UI.Style.RESET)
  UI.println("═".repeat(50))
  UI.println()

  // Summary
  UI.println(UI.Style.TEXT_INFO_BOLD + "Summary:" + UI.Style.RESET)
  UI.println(`  Benchmark ID: ${result.benchmark_id}`)
  UI.println(`  Task:         ${result.task.slice(0, 50)}...`)
  UI.println(`  Model:        ${result.model}`)
  UI.println(`  Timestamp:    ${new Date(result.timestamp).toISOString()}`)
  UI.println()

  // Hybrid results
  UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Hybrid Compaction:" + UI.Style.RESET)
  printRunMetrics(result.hybrid)
  UI.println()

  // Legacy results
  UI.println(UI.Style.TEXT_WARNING_BOLD + "Legacy Compaction:" + UI.Style.RESET)
  printRunMetrics(result.legacy)
  UI.println()

  // Comparison
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Comparison:" + UI.Style.RESET)
  const tokenSavingsColor = result.comparison.token_savings_percent > 0
    ? UI.Style.TEXT_SUCCESS
    : UI.Style.TEXT_DANGER
  const timeSavingsColor = result.comparison.time_savings_percent > 0
    ? UI.Style.TEXT_SUCCESS
    : UI.Style.TEXT_DANGER

  UI.println(`  Token savings:  ${tokenSavingsColor}${result.comparison.token_savings_percent.toFixed(1)}%${UI.Style.RESET}`)
  UI.println(`  Time savings:   ${timeSavingsColor}${result.comparison.time_savings_percent.toFixed(1)}%${UI.Style.RESET}`)

  const winnerStyle = result.comparison.winner === "hybrid"
    ? UI.Style.TEXT_SUCCESS_BOLD
    : result.comparison.winner === "legacy"
      ? UI.Style.TEXT_WARNING_BOLD
      : UI.Style.TEXT_DIM

  UI.println(`  Winner:         ${winnerStyle}${result.comparison.winner?.toUpperCase() || "N/A"}${UI.Style.RESET}`)

  // LLM judgment if available
  if (result.llm_judgment) {
    UI.println()
    UI.println(UI.Style.TEXT_INFO_BOLD + "LLM Judgment:" + UI.Style.RESET)
    UI.println(`  Winner:     ${result.llm_judgment.winner}`)
    UI.println(`  Rationale:  ${result.llm_judgment.rationale}`)
  }

  UI.println()
  UI.println("═".repeat(50))
}

function printRunMetrics(metrics: BenchmarkMetrics.RunMetrics) {
  UI.println(`  Run ID:       ${metrics.run_id}`)
  UI.println(`  Completed:    ${metrics.task_completed ? "Yes" : "No"}`)
  UI.println(`  Compactions:  ${metrics.total_compactions}`)

  if (metrics.compactions.length > 0) {
    const totalTokens = metrics.compactions.reduce((sum, c) => sum + c.tokens.total, 0)
    const totalTime = metrics.compactions.reduce((sum, c) => sum + c.duration_ms, 0)
    const avgCompression = metrics.compactions.reduce((sum, c) => sum + c.compression_ratio, 0) / metrics.compactions.length

    UI.println(`  Total tokens: ${totalTokens.toLocaleString()}`)
    UI.println(`  Total time:   ${(totalTime / 1000).toFixed(2)}s`)
    UI.println(`  Avg compression: ${(avgCompression * 100).toFixed(1)}%`)
  }

  if (metrics.error) {
    UI.println(`  ${UI.Style.TEXT_DANGER}Error: ${metrics.error}${UI.Style.RESET}`)
  }
}
