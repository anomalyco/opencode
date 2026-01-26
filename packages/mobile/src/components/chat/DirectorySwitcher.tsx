import { useState, useCallback, useMemo } from "react"
import { View, Text, TouchableOpacity, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import BottomSheet, { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetTextInput } from "@gorhom/bottom-sheet"

interface Props {
  sheetRef: React.RefObject<BottomSheet | null>
  current?: string
  recents: string[]
  serverHome: string | null
  isDark: boolean
  onSwitch: (directory?: string) => void
}

export function DirectorySwitcher({ sheetRef, current, recents, serverHome, isDark, onSwitch }: Props) {
  const [custom, setCustom] = useState("")

  const handleSelect = useCallback(
    (dir?: string) => {
      onSwitch(dir)
      setCustom("")
      sheetRef.current?.close()
    },
    [onSwitch, sheetRef],
  )

  const handleCustomSubmit = useCallback(() => {
    const dir = custom.trim()
    if (!dir) return
    handleSelect(dir)
  }, [custom, handleSelect])

  // Build list: server default + recents (excluding current)
  const items = useMemo(() => {
    const list: Array<{ label: string; dir?: string; active: boolean }> = [
      { label: "Server Default", dir: undefined, active: !current },
    ]
    for (const dir of recents) {
      if (dir === current) continue
      const short = dir.split("/").filter(Boolean).pop() || dir
      list.push({ label: short, dir, active: false })
    }
    return list
  }, [recents, current])

  const shortCurrent = current ? current.split("/").filter(Boolean).pop() || current : null

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={["45%", "70%"]}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={isDark ? s.sheetDark : s.sheet}
      handleIndicatorStyle={{ backgroundColor: isDark ? "#666666" : "#cccccc" }}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
      )}
      onChange={(idx) => {
        if (idx === -1) setCustom("")
      }}
    >
      <View style={s.header}>
        <Text style={[s.title, isDark && s.white]}>Switch Project</Text>
        {shortCurrent && (
          <View style={s.current}>
            <Ionicons name="folder" size={14} color="#8b5cf6" />
            <Text style={s.currentText} numberOfLines={1}>
              {shortCurrent}
            </Text>
          </View>
        )}
      </View>

      {/* Custom directory input */}
      <View style={s.inputWrap}>
        <BottomSheetTextInput
          style={[s.input, isDark && s.inputDark]}
          placeholder={serverHome ? `${serverHome}/...` : "/path/to/project"}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={custom}
          onChangeText={(text) => {
            if (serverHome && text === "~") setCustom(serverHome)
            else if (serverHome && text.startsWith("~/")) setCustom(serverHome + text.slice(1))
            else setCustom(text)
          }}
          onSubmitEditing={handleCustomSubmit}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {custom.trim() && (
          <TouchableOpacity style={[s.goBtn, isDark && s.goBtnDark]} onPress={handleCustomSubmit}>
            <Ionicons name="arrow-forward" size={18} color={isDark ? "#0a0a0a" : "#ffffff"} />
          </TouchableOpacity>
        )}
      </View>

      {/* Quick path chips */}
      {serverHome && (
        <View style={s.chips}>
          <TouchableOpacity style={[s.chip, isDark && s.chipDark]} onPress={() => setCustom(serverHome)}>
            <Text style={[s.chipText, isDark && s.chipTextDark]}>~</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.chip, isDark && s.chipDark]} onPress={() => setCustom(serverHome + "/")}>
            <Text style={[s.chipText, isDark && s.chipTextDark]}>~/</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Recent directories */}
      <BottomSheetFlatList
        data={items}
        keyExtractor={(item: (typeof items)[number], i: number) => item.dir || `default-${i}`}
        renderItem={({ item }: { item: (typeof items)[number] }) => (
          <TouchableOpacity
            style={[s.row, isDark && s.rowDark, item.active && s.rowActive]}
            onPress={() => handleSelect(item.dir)}
          >
            <View style={s.rowIcon}>
              <Ionicons
                name={item.dir ? "folder-outline" : "server-outline"}
                size={20}
                color={item.active ? "#8b5cf6" : isDark ? "#888888" : "#666666"}
              />
            </View>
            <View style={s.rowContent}>
              <Text style={[s.rowLabel, isDark && s.white, item.active && s.rowLabelActive]} numberOfLines={1}>
                {item.label}
              </Text>
              {item.dir && (
                <Text style={[s.rowPath, isDark && s.dimDark]} numberOfLines={1}>
                  {item.dir}
                </Text>
              )}
              {!item.dir && <Text style={[s.rowPath, isDark && s.dimDark]}>Uses server's working directory</Text>}
            </View>
            {item.active && <Ionicons name="checkmark-circle" size={20} color="#8b5cf6" />}
          </TouchableOpacity>
        )}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          items.length > 1 ? <Text style={[s.section, isDark && s.dimDark]}>Recent Projects</Text> : null
        }
      />
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  sheet: { backgroundColor: "#ffffff" },
  sheetDark: { backgroundColor: "#1a1a1a" },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  title: { fontSize: 18, fontWeight: "700", color: "#0a0a0a" },
  white: { color: "#ffffff" },
  current: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  currentText: {
    fontSize: 13,
    color: "#8b5cf6",
    fontWeight: "500",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  chips: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#e8e5f0",
    borderRadius: 16,
  },
  chipDark: {
    backgroundColor: "#2a2040",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6d28d9",
  },
  chipTextDark: {
    color: "#c4b5fd",
  },
  input: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0a0a0a",
  },
  inputDark: { backgroundColor: "#2a2a2a", color: "#ffffff" },
  goBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
  },
  goBtnDark: { backgroundColor: "#ffffff" },
  list: { paddingBottom: 40 },
  section: {
    fontSize: 12,
    fontWeight: "700",
    color: "#999999",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  dimDark: { color: "#666666" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    gap: 12,
  },
  rowDark: { borderBottomColor: "#2a2a2a" },
  rowActive: { backgroundColor: "#f5f3ff" },
  rowIcon: { width: 28, alignItems: "center" },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "500", color: "#0a0a0a" },
  rowLabelActive: { color: "#8b5cf6" },
  rowPath: { fontSize: 12, color: "#999999", marginTop: 1 },
})
