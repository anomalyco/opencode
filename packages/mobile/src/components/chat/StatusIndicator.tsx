import { View, Text, StyleSheet, ActivityIndicator } from "react-native"
import { useEvents } from "../../stores/events"
import { useSessions } from "../../stores/sessions"

interface Props {
  sessionID: string
  isDark: boolean
}

export function StatusIndicator({ sessionID, isDark }: Props) {
  const status = useEvents((s) => s.sessionStatus[sessionID])
  const text = useEvents((s) => s.statusText[sessionID])
  const optimistic = useSessions((s) => s.sending[sessionID])

  // SSE status is the source of truth. The optimistic `sending` flag only
  // covers the gap between the user tapping send and SSE confirming busy.
  // Once SSE reports idle, the indicator hides regardless of the optimistic flag.
  const sseBusy = status && status.type !== "idle"
  const busy = sseBusy || (optimistic && !status)
  if (!busy) return null

  const label = status?.type === "retry" ? `Retrying (attempt ${status.attempt})...` : text || "Working..."

  return (
    <View style={[s.bar, isDark && s.barDark]}>
      <ActivityIndicator size="small" color="#8b5cf6" />
      <Text style={[s.text, isDark && s.textDark]}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f5f3ff",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
  },
  barDark: { backgroundColor: "#1a1a2e", borderTopColor: "#2a2a2a" },
  text: { fontSize: 13, color: "#6d28d9", fontWeight: "500" },
  textDark: { color: "#a78bfa" },
})
