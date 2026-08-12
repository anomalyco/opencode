import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

export const webLifecycleFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "web-lifecycle",
    title: "Web tool lifecycle",
    group: { id: "tool-use", label: "Tool use" },
    description: "Run the v2 WebFetch and WebSearch renderers with real tool calls.",
  },
  ({ state, program }) => {
    const webfetchStreaming = state("webfetch-streaming", {
      screen: {
        title: "WebFetch streaming",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["transcript", "tool-card", "status-indicator"],
        surfaces: "inline",
        patterns: "status",
        features: ["tool", "web"],
        states: "streaming",
      },
      step: { title: "WebFetch input streams" },
    })
    const webfetchSuccess = state("webfetch-success", {
      screen: {
        title: "WebFetch succeeds",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["transcript", "tool-card", "confirmation"],
        surfaces: "inline",
        patterns: "status",
        features: ["tool", "web"],
        states: "success",
      },
      step: { title: "WebFetch succeeds" },
    })
    const websearchRunning = state("websearch-running", {
      screen: {
        title: "WebSearch running",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["transcript", "tool-card", "status-indicator"],
        surfaces: "inline",
        patterns: "status",
        features: ["tool", "web", "search"],
        states: "running",
      },
      step: { title: "WebSearch runs" },
    })
    const websearchFailure = state("websearch-failure", {
      screen: {
        title: "WebSearch fails",
        category: "session",
        screenLabels: ["tool-execution", "error-recovery"],
        uiElements: ["transcript", "tool-card", "error-report"],
        surfaces: "inline",
        patterns: "error-report",
        features: ["tool", "web", "search"],
        states: "error",
      },
      step: { title: "WebSearch reports provider failure" },
    })

    return program(
      [webfetchStreaming, webfetchSuccess, websearchRunning, websearchFailure],
      ({ driver, checkpoint }) => Effect.gen(function* () {
        yield* driver.llm.queue(
          Llm.toolCall(
            {
              index: 0,
              id: "call_webfetch_success",
              name: "webfetch",
              input: { url: "https://example.com", format: "text" },
            },
            { delay: 300, chunkSize: 1 },
          ),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The web fetch is complete."))
        yield* driver.llm.queue(
          Llm.toolCall(
            {
              index: 0,
              id: "call_websearch_failure",
              name: "websearch",
              input: { query: "opencode terminal interface", numResults: 3 },
            },
            { delay: 300, chunkSize: 1 },
          ),
          Llm.finish("tool-calls"),
        )

        yield* driver.ui.submit("Fetch the Example Domain.")
        yield* driver.ui.waitFor("Fetching from the web...", { timeout: 30_000 })
        yield* checkpoint(webfetchStreaming)
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The web fetch is complete.", { timeout: 30_000 })
        yield* checkpoint(webfetchSuccess)

        yield* driver.ui.submit("Search the web for the OpenCode terminal interface.")
        yield* driver.ui.waitFor("Searching web...", { timeout: 30_000 })
        yield* checkpoint(websearchRunning)
        yield* Effect.sleep(1_000)
        yield* checkpoint(websearchFailure)
      }),
    )
  },
)
