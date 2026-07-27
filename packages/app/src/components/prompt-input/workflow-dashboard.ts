import type { useDialog } from "@opencode-ai/ui/context/dialog"

// Opens the workflow dashboard modal. The dashboard component (Task 6) reads the
// dir-scoped SDK + dialog from context itself, so this helper only needs the
// dialog handle to mount it. Lazy-imported (matching the app's other panels, e.g.
// `use-session-commands.tsx`) so the dashboard's code is not in the prompt-input
// bundle until first opened. Returns the promise from the dynamic import so the
// submit path can `void` it.
export function openWorkflowDashboard(dialog: ReturnType<typeof useDialog>) {
  return import("@/components/dialog-workflow").then((module) => {
    dialog.show(() => module.DialogWorkflow({}))
  })
}
