import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

const screen = (title: string, states: "streaming" | "running" | "success" | "empty" | "error") => ({
  title,
  category: "session" as const,
  screenLabels: states === "error" ? (["tool-execution", "error-recovery"] as const) : (["tool-execution"] as const),
  uiElements:
    states === "error"
      ? (["transcript", "tool-card", "error-report"] as const)
      : states === "empty"
        ? (["transcript", "tool-card", "empty-state"] as const)
        : (["transcript", "tool-card", "status-indicator"] as const),
  surfaces: "inline" as const,
  patterns: states === "error" ? ("error-report" as const) : ("status" as const),
  features: ["tool", "search"] as const,
  states,
})

export const searchLifecycleFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "search-lifecycle",
    title: "Project search lifecycle",
    group: { id: "tool-use", label: "Tool use" },
    description: "Run built-in glob and grep tools through distinct streaming, grouped, success, empty, and failure states.",
  },
  ({ state, program }) => {
    const globSuccess = state("glob-success", {
      screen: screen("Glob finds files", "success"),
      step: { title: "Glob succeeds" },
    })
    const globEmpty = state("glob-empty", {
      screen: screen("Glob finds no files", "empty"),
      step: { title: "Glob is empty" },
    })
    const groupedExploration = state("grouped-exploration", {
      screen: screen("Grouped project exploration", "running"),
      step: { title: "Glob and grep run together" },
    })
    const grepSuccess = state("grep-success", {
      screen: screen("Grep finds matches", "success"),
      step: { title: "Grep succeeds" },
    })
    const grepEmpty = state("grep-empty", {
      screen: screen("Grep finds no matches", "empty"),
      step: { title: "Grep is empty" },
    })
    const grepFailure = state("grep-failure", {
      screen: screen("Grep pattern fails", "error"),
      step: { title: "Grep fails" },
    })

    return program(
      [globSuccess, globEmpty, groupedExploration, grepSuccess, grepEmpty, grepFailure],
      ({ driver, checkpoint }) => Effect.gen(function* () {
        yield* driver.llm.queue(
          Llm.toolCall(
            { index: 0, id: "call_glob_success", name: "glob", input: { pattern: "src/**/*.ts" } },
            { delay: 100, chunkSize: 4 },
          ),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The first glob search is complete."))
        yield* driver.llm.queue(
          Llm.toolCall({ index: 0, id: "call_glob_empty", name: "glob", input: { pattern: "missing/**/*.rs" } }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The empty glob search is complete."))
        yield* driver.llm.queue(
          Llm.toolCall({ index: 0, id: "call_group_glob", name: "glob", input: { pattern: "**/*.ts" } }),
          Llm.toolCall({ index: 1, id: "call_group_grep", name: "grep", input: { pattern: "credits", path: "src" } }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The grouped exploration is complete."))
        yield* driver.llm.queue(
          Llm.toolCall({ index: 0, id: "call_grep_success", name: "grep", input: { pattern: "credits", path: "src" } }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The matching grep search is complete."))
        yield* driver.llm.queue(
          Llm.toolCall({ index: 0, id: "call_grep_empty", name: "grep", input: { pattern: "DEADBEEF", path: "src" } }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The empty grep search is complete."))
        yield* driver.llm.queue(
          Llm.toolCall({ index: 0, id: "call_grep_failure", name: "grep", input: { pattern: "[", path: "src" } }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The invalid grep search is complete."))

        yield* driver.ui.submit("Find the TypeScript source files.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The first glob search is complete.", { timeout: 15_000 })
        yield* checkpoint(globSuccess)

        yield* driver.ui.submit("Find Rust files that do not exist.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The empty glob search is complete.", { timeout: 15_000 })
        yield* checkpoint(globEmpty)

        yield* driver.ui.submit("Explore TypeScript files and search them for credits together.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* Effect.sleep(500)
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The grouped exploration is complete.", { timeout: 15_000 })
        yield* checkpoint(groupedExploration)

        yield* driver.ui.submit("Search the source directory for credits.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The matching grep search is complete.", { timeout: 15_000 })
        yield* checkpoint(grepSuccess)

        yield* driver.ui.submit("Search the source directory for DEADBEEF.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The empty grep search is complete.", { timeout: 15_000 })
        yield* checkpoint(grepEmpty)

        yield* driver.ui.submit("Run an invalid regular expression search.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The invalid grep search is complete.", { timeout: 15_000 })
        yield* checkpoint(grepFailure)
      }),
    )
  },
)
