import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView } from "react-native"
import { Ionicons } from "@expo/vector-icons"

export interface Attachment {
  uri: string
  mime: string
  filename?: string
  width?: number
  height?: number
  base64?: string
}

interface Props {
  attachments: Attachment[]
  isDark: boolean
  onRemove: (index: number) => void
}

export function ImageAttachments({ attachments, isDark, onRemove }: Props) {
  if (attachments.length === 0) return null

  return (
    <View style={[s.container, isDark && s.containerDark]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {attachments.map((att, idx) => (
          <View key={`${att.uri}-${idx}`} style={s.thumb}>
            <Image source={{ uri: att.uri }} style={s.image} resizeMode="cover" />
            <TouchableOpacity style={[s.remove, isDark && s.removeDark]} onPress={() => onRemove(idx)}>
              <Ionicons name="close" size={14} color="#ffffff" />
            </TouchableOpacity>
            {att.filename && (
              <Text style={[s.label, isDark && s.labelDark]} numberOfLines={1}>
                {att.filename}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  containerDark: { backgroundColor: "#0a0a0a", borderTopColor: "#1a1a1a" },
  scroll: { gap: 8 },
  thumb: { position: "relative" },
  image: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  remove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  removeDark: { backgroundColor: "#ef4444", borderColor: "#0a0a0a" },
  label: {
    fontSize: 10,
    color: "#666666",
    marginTop: 2,
    maxWidth: 72,
    textAlign: "center",
  },
  labelDark: { color: "#888888" },
})
