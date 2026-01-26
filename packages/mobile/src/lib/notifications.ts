import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { Platform, AppState } from "react-native"

// ---------------------------------------------------------------------------
// Categories — every notification belongs to exactly one
// ---------------------------------------------------------------------------

export const categories = ["permissions", "questions", "completed", "errors"] as const
export type Category = (typeof categories)[number]

// Per-category metadata used by both the notification module and the settings UI
export const categoryMeta: Record<Category, { label: string; description: string; icon: string }> = {
  permissions: {
    label: "Permission Requests",
    description: "When a tool needs approval to proceed",
    icon: "shield-checkmark",
  },
  questions: {
    label: "Questions",
    description: "When the assistant needs your input",
    icon: "help-circle",
  },
  completed: {
    label: "Task Completed",
    description: "When a session finishes processing",
    icon: "checkmark-circle",
  },
  errors: {
    label: "Errors",
    description: "When a session encounters a problem",
    icon: "alert-circle",
  },
}

// Default state — permissions and questions on (they block work), the rest off
export const defaultPreferences: Record<Category, boolean> = {
  permissions: true,
  questions: true,
  completed: false,
  errors: true,
}

// ---------------------------------------------------------------------------
// Notification payload — what callers pass in
// ---------------------------------------------------------------------------

export interface Payload {
  category: Category
  title: string
  body: string
  sessionId: string
}

// Data embedded in the notification for tap handling
interface NotificationData {
  category: Category
  sessionId: string
}

// ---------------------------------------------------------------------------
// Preferences accessor — injected to avoid circular imports with the store
// ---------------------------------------------------------------------------

type PreferencesAccessor = () => Record<Category, boolean>

let preferences: PreferencesAccessor = () => defaultPreferences

export function configure(accessor: PreferencesAccessor) {
  preferences = accessor
}

// ---------------------------------------------------------------------------
// Setup & permissions
// ---------------------------------------------------------------------------

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export async function setup(): Promise<boolean> {
  if (!Device.isDevice) return false

  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === "granted") {
    await ensureChannel()
    return true
  }

  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== "granted") return false

  await ensureChannel()
  return true
}

export async function granted(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync()
  return status === "granted"
}

async function ensureChannel() {
  if (Platform.OS !== "android") return
  await Notifications.setNotificationChannelAsync("prompts", {
    name: "Session Prompts & Updates",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
  })
}

// ---------------------------------------------------------------------------
// Send — single entry point, decides whether to fire
// ---------------------------------------------------------------------------

export async function send(payload: Payload) {
  const prefs = preferences()
  if (!prefs[payload.category]) return
  if (AppState.currentState === "active") return
  if (!(await granted())) return

  await Notifications.scheduleNotificationAsync({
    content: {
      title: payload.title,
      body: payload.body,
      data: {
        category: payload.category,
        sessionId: payload.sessionId,
      } satisfies NotificationData as Record<string, unknown>,
      sound: "default",
      ...(Platform.OS === "android" ? { channelId: "prompts" } : {}),
    },
    trigger: null,
  })
}

// ---------------------------------------------------------------------------
// Tap handler — returns cleanup function
// ---------------------------------------------------------------------------

export function onTap(handler: (data: NotificationData) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const raw = response.notification.request.content.data
    const data = raw as unknown as NotificationData | undefined
    if (data?.sessionId) handler(data)
  })
  return () => subscription.remove()
}
