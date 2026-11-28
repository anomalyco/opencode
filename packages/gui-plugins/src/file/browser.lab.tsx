import { lazy, Show, Suspense } from "solid-js"
import type { CommentDelivery } from "../../../lab/mocks/gui-plugins/workspace-panel"

const Panel = lazy(() => import("../../../lab/mocks/gui-plugins/workspace-panel"))

export default {
  title: "App/Plugins/Files",
  id: "plugins-files",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Browse the workspace tree or search by name. Switch Markdown or CSV between preview and source, or inspect the Office viewer’s explanation for a protected document.\n\nComments: in a source file, click a line number and type. Enter adds the comment; Mod+Enter adds and sends it, labelled by the Delivery control: Send comment while the session is idle, Steer comment or Queue comment by the follow-up behavior while it works, or disabled while nothing can be sent. Hover Comment for both actions, or hold Mod to switch it. A sent comment leaves the file.",
      },
    },
  },
  args: { initialFile: "README.md", delivery: "Steer" },
  argTypes: {
    delivery: { control: "select", options: ["Send", "Steer", "Queue", "Unavailable"] satisfies CommentDelivery[] },
    initialFile: {
      control: "select",
      options: ["Open file", "README.md", "src/status.ts", "docs/checks.csv", "docs/protected.docx", "removed.ts"],
    },
  },
  render: (args: { initialFile: string; delivery: CommentDelivery }) => (
    <Suspense>
      <Show when={args.initialFile} keyed>
        {(path) => <Panel plugin="file" path={path === "Open file" ? undefined : path} delivery={args.delivery} />}
      </Show>
    </Suspense>
  ),
}

export const Workspace = {}

export const ChooseFile = { args: { initialFile: "Open file" } }

export const Source = { args: { initialFile: "src/status.ts" } }

export const TablePreview = { args: { initialFile: "docs/checks.csv" } }

export const ProtectedDocument = { args: { initialFile: "docs/protected.docx" } }

export const MissingFile = { args: { initialFile: "removed.ts" } }

/** The session is idle: a line comment's Mod+Enter reads "Send comment". */
export const CommentSend = { args: { initialFile: "src/status.ts", delivery: "Send" } }

/** The session works and the follow-up behavior steers: "Steer comment". */
export const CommentSteer = { args: { initialFile: "src/status.ts", delivery: "Steer" } }

/** The session works and the follow-up behavior queues: "Queue comment". */
export const CommentQueue = { args: { initialFile: "src/status.ts", delivery: "Queue" } }

/** Nothing can be sent now: the action stays listed but disabled. */
export const CommentSendUnavailable = { args: { initialFile: "src/status.ts", delivery: "Unavailable" } }
