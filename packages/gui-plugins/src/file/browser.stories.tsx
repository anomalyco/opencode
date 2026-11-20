import { lazy, Show, Suspense } from "solid-js"

const Panel = lazy(() => import("../../../stories/mocks/gui-plugins/workspace-panel"))

export default {
  title: "App/Plugins/Files",
  id: "plugins-files",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Browse the workspace tree or search by name. Switch Markdown or CSV between preview and source, or inspect the Office viewer’s explanation for a protected document.",
      },
    },
  },
  args: { initialFile: "README.md" },
  argTypes: {
    initialFile: {
      control: "select",
      options: ["Open file", "README.md", "src/status.ts", "docs/checks.csv", "docs/protected.docx", "removed.ts"],
    },
  },
  render: (args: { initialFile: string }) => (
    <Suspense>
      <Show when={args.initialFile} keyed>
        {(path) => <Panel plugin="file" path={path === "Open file" ? undefined : path} />}
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
