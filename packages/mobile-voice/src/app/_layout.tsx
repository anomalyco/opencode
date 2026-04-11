import React from "react"
import { Slot } from "expo-router"
import { LogBox } from "react-native"
import {
  configureNotificationBehavior,
  registerBackgroundNotificationTask,
} from "@/notifications/monitoring-notifications"

// Suppress known non-actionable warnings from third-party libs.
LogBox.ignoreLogs([
  "RecordingNotificationManager is not implemented on iOS",
  "`transcribeRealtime` is deprecated, use `RealtimeTranscriber` instead",
  "Parsed error meta:",
  "Session activation failed",
])

configureNotificationBehavior()
registerBackgroundNotificationTask().catch(() => {})

export default function RootLayout() {
  return <Slot />
}
