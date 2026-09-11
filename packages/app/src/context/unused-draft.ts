import type { DraftTab, Tab } from "./tabs"

export function existingUnusedDraft(tabs: Tab[], next: Pick<DraftTab, "server" | "directory">) {
  const drafts = tabs.filter((tab): tab is DraftTab => tab.type === "draft")
  return drafts.find((tab) => tab.server === next.server && tab.directory === next.directory) ?? drafts[0]
}
