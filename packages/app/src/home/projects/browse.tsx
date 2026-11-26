import { useDialog } from "@opencode/ui/context/dialog"
import { lazy, Suspense } from "solid-js"
import type { ServerConnection } from "@/runtime/server/registry"

export type ProjectBrowserTarget = { server: ServerConnection.Key; directory: string }

const ProjectBrowser = lazy(() => import("./browse-view"))

export function useProjectBrowser() {
  const dialog = useDialog()

  return (initial?: ProjectBrowserTarget) => {
    // A menu item unmounts on selection, so return focus to its trigger.
    const triggerID = document.activeElement?.closest('[role="menu"]')?.getAttribute("aria-labelledby")

    const trigger = triggerID && document.getElementById(triggerID)

    void dialog.show(
      () => (
        <Suspense>
          <ProjectBrowser initial={initial} />
        </Suspense>
      ),
      () => {
        if (!trigger) return
        queueMicrotask(() => {
          if (trigger.isConnected && document.activeElement === document.body && !dialog.active)
            trigger.focus({ preventScroll: true })
        })
      },
    )
  }
}
