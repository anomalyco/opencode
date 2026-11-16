import { lazy, Show, Suspense } from "solid-js"
import type { ChangesScenario } from "../../../stories/mocks/gui-plugins/workspace-panel"

const Panel = lazy(() => import("../../../stories/mocks/gui-plugins/workspace-panel"))

export default {
  title: "App/Plugins/Review",
  id: "plugins-review",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Select or filter a changed file, switch diff layouts, and leave a line comment. The failed working-tree read succeeds on retry.",
      },
    },
  },
  args: { scenario: "Changes" },
  argTypes: { scenario: { control: "select", options: ["Changes", "Clean", "Read error", "Offline"] } },
  render: (args: { scenario: ChangesScenario }) => (
    <Suspense>
      <Show when={args.scenario} keyed>
        {(scenario) => <Panel plugin="review" scenario={scenario} />}
      </Show>
    </Suspense>
  ),
}

export const ChangesAndComments = {}

export const Empty = { args: { scenario: "Clean" } }

export const ReadError = { args: { scenario: "Read error" } }

export const Offline = { args: { scenario: "Offline" } }
