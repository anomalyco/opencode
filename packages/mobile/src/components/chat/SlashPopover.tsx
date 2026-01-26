import { useMemo } from "react"
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Keyboard, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"

export interface SlashCommand {
  trigger: string
  title: string
  description?: string
  icon: string
  type: "builtin" | "custom"
}

interface Props {
  query: string
  commands: SlashCommand[]
  isDark: boolean
  onSelect: (cmd: SlashCommand) => void
}

export function SlashPopover({ query, commands, isDark, onSelect }: Props) {
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return commands.filter((c) => c.trigger.toLowerCase().startsWith(q) || c.title.toLowerCase().includes(q))
  }, [query, commands])

  if (filtered.length === 0) return null

  return (
    <View style={[s.popover, isDark && s.popoverDark]}>
      <ScrollView keyboardShouldPersistTaps="always" style={s.scroll}>
        {filtered.map((cmd) => (
          <TouchableOpacity key={cmd.trigger} style={[s.item, isDark && s.itemDark]} onPress={() => onSelect(cmd)}>
            <Ionicons
              name={cmd.icon as any}
              size={18}
              color={cmd.type === "custom" ? "#8b5cf6" : isDark ? "#888888" : "#666666"}
            />
            <View style={s.textCol}>
              <Text style={[s.trigger, isDark && s.textWhite]}>/{cmd.trigger}</Text>
              {cmd.description && (
                <Text style={[s.desc, isDark && s.metaDark]} numberOfLines={1}>
                  {cmd.description}
                </Text>
              )}
            </View>
            {cmd.type === "custom" && (
              <View style={[s.badge, isDark && s.badgeDark]}>
                <Text style={s.badgeText}>cmd</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  popover: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    maxHeight: 220,
  },
  popoverDark: { backgroundColor: "#1a1a1a", borderTopColor: "#2a2a2a" },
  scroll: { paddingVertical: 4 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  itemDark: {},
  textCol: { flex: 1 },
  trigger: { fontSize: 14, fontWeight: "600", color: "#0a0a0a" },
  textWhite: { color: "#ffffff" },
  desc: { fontSize: 12, color: "#999999", marginTop: 1 },
  metaDark: { color: "#666666" },
  badge: {
    backgroundColor: "#f3e8ff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeDark: { backgroundColor: "#2a1a3e" },
  badgeText: { fontSize: 10, color: "#8b5cf6", fontWeight: "600" },
})
