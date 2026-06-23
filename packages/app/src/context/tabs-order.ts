export type TabOrderItem =
  | {
      type: "session"
      server: string
      sessionId: string
    }
  | {
      type: "draft"
      draftID: string
    }

export function canTileSessionTabs(count: number) {
  return count >= 2 && count <= 4
}

export const tabOrderKey = (tab: TabOrderItem) =>
  tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${tab.sessionId}`
