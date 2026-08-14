import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../catalog/flow"
import { taxonomies } from "../catalog/authored/taxonomies"

export const sessionTabsFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "session-tabs-lifecycle",
    title: "Monitoring session tabs",
    group: { id: "session-management", label: "Session management" },
    description: "Compare an idle session strip with a session actively running work.",
  },
  ({ state, program }) => {
    const running = state("session-tabs-running", {
      screen: {
        title: "Session tabs (running)",
        category: "session",
        screenLabels: ["session-list"],
        uiElements: ["tabs", "full-screen-view", "status-indicator", "keyboard-hints", "transcript"],
        surfaces: "full-screen",
        patterns: "navigation",
        features: ["session", "tabs"],
        states: "running",
      },
      step: { title: "Review a running tab", trigger: "Start the selected session" },
    })
    const idle = state("session-tabs-idle", {
      screen: {
        title: "Session tabs (idle)",
        category: "session",
        screenLabels: ["session-list"],
        uiElements: ["tabs", "full-screen-view", "status-indicator", "keyboard-hints"],
        surfaces: "full-screen",
        patterns: "navigation",
        features: ["session", "tabs"],
        states: "idle",
      },
      step: { title: "Review idle tabs" },
    })

    return program([running, idle], ({ driver, checkpoint }) =>
      Effect.gen(function* () {
        yield* driver.llm.queue(Llm.text("Working on a tab audit."), Llm.pause(2_000), Llm.text("Tab audit complete."))
        yield* driver.ui.submit("Audit the current tab state.")
        yield* driver.ui.waitFor("Working on a tab audit.", { timeout: 15_000 })
        yield* checkpoint(running)
        yield* driver.ui.waitFor("Tab audit complete.", { timeout: 15_000 })
        yield* checkpoint(idle)
      }),
    )
  },
)
