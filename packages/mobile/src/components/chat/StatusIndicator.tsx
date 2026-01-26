import { View, Text, StyleSheet, ActivityIndicator } from "react-native"
import { useEvents } from "../../stores/events"

interface Props {
  sessionID: string
  isDark: boolean
}

export function StatusIndicator({ sessionID, isDark }: Props) {
  const status = useEvents((s) => s.sessionStatus[sessionID])
  const text = useEvents((s) => s.statusText[sessionID])

  if (!status || status.type === "idle") return null

  return (
    <View style={[s.bar, isDark && s.barDark]}>
      <ActivityIndicator size="small" color="#8b5cf6" />
      <Text style={[s.text, isDark && s.textDark]}>
        {status.type === "retry" ? `Retrying (attempt ${status.attempt})...` : text || "Working..."}
      </Text>
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
