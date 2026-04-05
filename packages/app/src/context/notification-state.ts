import type { EventSessionError } from "@opencode-ai/sdk/v2"

type NotificationBase = {
  directory?: string
  session?: string
  metadata?: unknown
  time: number
  viewed: boolean
}

type TurnCompleteNotification = NotificationBase & {
  type: "turn-complete"
}

type ErrorNotification = NotificationBase & {
  type: "error"
  error: EventSessionError["properties"]["error"]
}

export type Notification = TurnCompleteNotification | ErrorNotification

export function markCurrentNotifications(list: Notification[], session: string, directory: string) {
  let changed = false
  const next = list.map((item) => {
    if (item.session !== session) return item
    if (item.directory !== directory) return item
    if (item.viewed) return item
    changed = true
    return {
      ...item,
      viewed: true,
    }
  })
  return changed ? next : list
}
