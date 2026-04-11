import * as Notifications from "expo-notifications"
import * as TaskManager from "expo-task-manager"
import { Platform } from "react-native"

const BACKGROUND_TASK_NAME = "monitoring-background-notification-task"

type BackgroundPayload = {
  eventType?: string
  sessionID?: string
  title?: string
  body?: string
}

let configured = false

TaskManager.defineTask(BACKGROUND_TASK_NAME, async ({ data }: { data?: unknown }) => {
  const payload = data as BackgroundPayload | undefined
  const title = payload?.title ?? "OpenCode update"
  const body = payload?.body ?? "Your monitored session has a new update."

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: payload ?? {},
      sound: "alert.wav",
      ...(Platform.OS === "android" ? { channelId: "monitoring" } : {}),
    },
    trigger: null,
  })

  return Notifications.BackgroundNotificationTaskResult.NewData
})

export function configureNotificationBehavior(): void {
  if (configured) return
  configured = true

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  })
}

export async function registerBackgroundNotificationTask(): Promise<void> {
  const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME)
  if (already) return
  await Notifications.registerTaskAsync(BACKGROUND_TASK_NAME)
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("monitoring", {
      name: "OpenCode Monitoring",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "alert.wav",
    })
  }

  const existing = await Notifications.getPermissionsAsync()
  let granted = existing.granted

  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync()
    granted = requested.granted
  }

  return granted
}

export async function getDevicePushToken(): Promise<string | null> {
  const result = await Notifications.getDevicePushTokenAsync()
  if (typeof result.data !== "string" || result.data.length === 0) {
    return null
  }
  return result.data
}

export function onPushTokenChange(callback: (token: string) => void): { remove: () => void } {
  return Notifications.addPushTokenListener((next: { data: unknown }) => {
    if (typeof next.data !== "string" || next.data.length === 0) return
    callback(next.data)
  })
}
