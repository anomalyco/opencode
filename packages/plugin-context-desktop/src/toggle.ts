import type { SessionContext } from "@opencode/plugin/desktop"

export function toggleContext(session: SessionContext) {
  const view = session.services?.view
  if (!view) return
  if (view.panel.opened() && view.tabs.active() === "context") {
    view.tabs.close("context")
    if (view.panel.source() === "context-button" && !view.tabs.all().some((tab) => view.tabs.canClose(tab)))
      view.panel.close()
    return
  }
  view.panel.open(view.panel.opened() ? "other" : "context-button")
  if (view.sidebar.opened()) view.sidebar.setTab("all")
  void view.tabs.open("context")
  view.tabs.setActive("context")
}
