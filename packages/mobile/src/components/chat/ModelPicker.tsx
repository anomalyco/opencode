import { useState, useCallback, useMemo, useRef } from "react"
import { View, Text, TouchableOpacity, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import BottomSheet, { BottomSheetBackdrop, BottomSheetSectionList, BottomSheetTextInput } from "@gorhom/bottom-sheet"

interface ModelItem {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
}

interface Provider {
  id: string
  name: string
  models: Array<{ id: string; name: string }>
}

interface Props {
  providers: Provider[]
  selected: { providerID: string; modelID: string } | null
  isDark: boolean
  onSelect: (providerID: string, modelID: string) => void
  sheetRef: React.RefObject<BottomSheet | null>
}

export function ModelPicker({ providers, selected, isDark, onSelect, sheetRef }: Props) {
  const [search, setSearch] = useState("")

  const sections = useMemo(() => {
    const list = Array.isArray(providers) ? providers : []
    const q = search.toLowerCase()
    const result = list
      .map((p) => {
        const models = (p.models || [])
          .filter(
            (m) =>
              !q ||
              m.id.toLowerCase().includes(q) ||
              m.name.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q),
          )
          .map((m) => ({
            providerID: p.id,
            providerName: p.name || p.id,
            modelID: m.id,
            modelName: m.name || m.id,
          }))
        // Sort selected model to top within its group
        if (selected) {
          models.sort((a, b) => {
            const aActive = a.providerID === selected.providerID && a.modelID === selected.modelID
            const bActive = b.providerID === selected.providerID && b.modelID === selected.modelID
            return aActive === bActive ? 0 : aActive ? -1 : 1
          })
        }
        return { title: p.name || p.id, data: models }
      })
      .filter((s) => s.data.length > 0)
    // Sort the section containing the selected model to the top
    if (selected) {
      result.sort((a, b) => {
        const aHas = a.data.some((m) => m.providerID === selected.providerID && m.modelID === selected.modelID)
        const bHas = b.data.some((m) => m.providerID === selected.providerID && m.modelID === selected.modelID)
        return aHas === bHas ? 0 : aHas ? -1 : 1
      })
    }
    return result
  }, [providers, search, selected])

  const handleSelect = useCallback(
    (providerID: string, modelID: string) => {
      onSelect(providerID, modelID)
      setSearch("")
      sheetRef.current?.close()
    },
    [onSelect, sheetRef],
  )

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={["50%", "80%"]}
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
        if (idx === -1) setSearch("")
      }}
    >
      <View style={s.header}>
        <Text style={[s.title, isDark && s.textWhite]}>Select Model</Text>
        <BottomSheetTextInput
          style={[s.search, isDark && s.searchDark]}
          placeholder="Search models..."
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <BottomSheetSectionList
        sections={sections}
        keyExtractor={(item: ModelItem) => `${item.providerID}/${item.modelID}`}
        renderSectionHeader={({ section }: { section: { title: string } }) => (
          <View style={[s.sectionHeader, isDark && s.sectionHeaderDark]}>
            <Text style={[s.sectionTitle, isDark && s.metaDark]}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }: { item: ModelItem }) => {
          const active = selected?.providerID === item.providerID && selected?.modelID === item.modelID
          return (
            <TouchableOpacity
              style={[s.row, isDark && s.rowDark, active && (isDark ? s.rowSelectedDark : s.rowSelected)]}
              onPress={() => handleSelect(item.providerID, item.modelID)}
            >
              <View style={s.rowText}>
                <Text style={[s.rowName, isDark && s.textWhite]} numberOfLines={1}>
                  {item.modelName || item.modelID}
                </Text>
                <Text style={[s.rowProvider, isDark && s.metaDark]}>{item.providerName || item.providerID}</Text>
              </View>
              {active && <Ionicons name="checkmark-circle" size={20} color="#8b5cf6" />}
            </TouchableOpacity>
          )
        }}
        contentContainerStyle={s.content}
        stickySectionHeadersEnabled
      />
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  sheet: { backgroundColor: "#ffffff" },
  sheetDark: { backgroundColor: "#1a1a1a" },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  title: { fontSize: 18, fontWeight: "700", color: "#0a0a0a" },
  textWhite: { color: "#ffffff" },
  search: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0a0a0a",
  },
  searchDark: { backgroundColor: "#2a2a2a", color: "#ffffff" },
  content: { paddingBottom: 40 },
  sectionHeader: {
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionHeaderDark: { backgroundColor: "#111111" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#999999",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaDark: { color: "#666666" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  rowDark: { borderBottomColor: "#2a2a2a" },
  rowSelected: { backgroundColor: "#f5f3ff" },
  rowSelectedDark: { backgroundColor: "#1f1a2e" },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: "500", color: "#0a0a0a" },
  rowProvider: { fontSize: 12, color: "#999999", marginTop: 1 },
})
