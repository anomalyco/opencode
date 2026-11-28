import { lazy, Show, Suspense } from "solid-js"
import type { ChangesScenario, CommentDelivery } from "../../../lab/mocks/gui-plugins/workspace-panel"

const Panel = lazy(() => import("../../../lab/mocks/gui-plugins/workspace-panel"))

export default {
  title: "App/Plugins/Review",
  id: "plugins-review",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Select or filter a changed file, switch diff layouts, and leave a line comment. The failed working-tree read succeeds on retry.\n\nComments: click a line number and type. Enter adds the comment; Mod+Enter adds and sends it, labelled by the Delivery control: Send comment while the session is idle, Steer comment or Queue comment by the follow-up behavior while it works, or disabled while nothing can be sent. Hover Comment for both actions, or hold Mod to switch it. A sent comment leaves the file.",
      },
    },
  },
  args: { scenario: "Changes", delivery: "Steer" },
  argTypes: {
    scenario: { control: "select", options: ["Changes", "Clean", "Read error", "Offline"] },
    delivery: { control: "select", options: ["Send", "Steer", "Queue", "Unavailable"] satisfies CommentDelivery[] },
  },
  render: (args: { scenario: ChangesScenario; delivery: CommentDelivery }) => (
    <Suspense>
      <Show when={args.scenario} keyed>
        {(scenario) => <Panel plugin="review" scenario={scenario} delivery={args.delivery} />}
      </Show>
    </Suspense>
  ),
}

export const ChangesAndComments = {}

export const Empty = { args: { scenario: "Clean" } }

export const ReadError = { args: { scenario: "Read error" } }

export const Offline = { args: { scenario: "Offline" } }

/** The session is idle: a diff comment's Mod+Enter reads "Send comment". */
export const CommentSend = { args: { delivery: "Send" } }

/** The session works and the follow-up behavior steers: "Steer comment". */
export const CommentSteer = { args: { delivery: "Steer" } }

/** The session works and the follow-up behavior queues: "Queue comment". */
export const CommentQueue = { args: { delivery: "Queue" } }

/** Nothing can be sent now: the action stays listed but disabled. */
export const CommentSendUnavailable = { args: { delivery: "Unavailable" } }
