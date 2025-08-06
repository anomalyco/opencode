import { memo, forwardRef, useState, useMemo, useCallback } from "react"
import { Pressable, TextInput } from "react-native"
import { BottomSheetSectionList } from "@gorhom/bottom-sheet"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { BottomSheet, type BottomSheetRef } from "@/components/ui/primitives/bottom-sheet"
import type { ModelWithProvider } from "@/types/commands"
import { useUnistyles } from "react-native-unistyles"
import { useLocalModelsQuery } from "@/services/api/local/models"
import { useUpdateSessionModelMutation } from "@/services/api/local/sessions"
import { Feather } from "@expo/vector-icons"
import { useSonner } from "@/hooks/use-sonner"

interface ModelsSheetProps {
  sessionId: string
  onModelSelect?: (model: ModelWithProvider) => void
}

export const ModelsSheet = memo(
  forwardRef<BottomSheetRef, ModelsSheetProps>(({ sessionId, onModelSelect }, ref) => {
    const { theme } = useUnistyles()
    const [searchQuery, setSearchQuery] = useState("")
    const sonner = useSonner()

    // Fetch local models
    const { data: localModels } = useLocalModelsQuery()

    // Mutation to update session model
    const updateSessionModel = useUpdateSessionModelMutation()

    // Transform local models to grouped sections
    const modalSections = useMemo(() => {
      if (!localModels || localModels.length === 0) {
        return []
      }

      // Filter models based on search first
      const filteredModels = searchQuery.trim()
        ? localModels.filter(
            (modal) =>
              modal.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              modal.providerName.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : localModels

      // Group by provider
      const groupedByProvider = filteredModels.reduce(
        (acc, modal) => {
          const providerId = modal.providerId
          if (!acc[providerId]) {
            acc[providerId] = {
              title: modal.providerName,
              data: [],
            }
          }
          acc[providerId].data.push({
            id: modal.id,
            name: modal.name,
            providerId: modal.providerId,
            providerName: modal.providerName,
            contextLength: modal.contextLength || undefined,
            inputPrice: modal.inputPrice || undefined,
            outputPrice: modal.outputPrice || undefined,
          })
          return acc
        },
        {} as Record<string, { title: string; data: ModelWithProvider[] }>,
      )

      const sections = Object.values(groupedByProvider)
      return sections
    }, [localModels, searchQuery])

    const dismissSheet = () => {
      if (ref && typeof ref === "object" && ref.current) {
        ref.current.dismiss()
      }
    }

    const handleModelSelect = async (model: ModelWithProvider) => {
      try {
        // Update the session's selected model in local DB
        await updateSessionModel.mutateAsync({
          id: sessionId,
          modelId: model.id,
        })

        sonner.success(`Switched to ${model.name}`)

        // Call optional callback
        onModelSelect?.(model)

        dismissSheet()
      } catch (error) {
        console.error("Model selection failed:", error)
        sonner.error("Failed to switch model")
        dismissSheet()
      }
    }

    const renderModel = useCallback(
      ({ item, index, section }: { item: ModelWithProvider; index: number; section: any }) => (
        <Box
          background="lightest"
          style={{
            marginHorizontal: 16,
            borderTopLeftRadius: index === 0 ? 12 : 0,
            borderTopRightRadius: index === 0 ? 12 : 0,
            borderBottomLeftRadius: index === section.data.length - 1 ? 12 : 0,
            borderBottomRightRadius: index === section.data.length - 1 ? 12 : 0,
            overflow: "hidden",
          }}
        >
          <Pressable
            onPress={() => handleModelSelect(item)}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Box direction="row" alignItems="center">
              {/* Icon */}
              <Box
                background="subtle"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 12,
                }}
              >
                <Icon icon={Feather} name="cpu" size={20} color={theme.colors.brand[500]} />
              </Box>

              {/* Content */}
              <Box flex>
                <Text weight="medium">{item.name}</Text>
                {item.contextLength && (
                  <Text size="sm" style={{ color: theme.colors.text.subtle, marginTop: 2 }}>
                    {item.contextLength.toLocaleString()} tokens
                  </Text>
                )}
              </Box>
            </Box>
          </Pressable>
          {index < section.data.length - 1 && (
            <Box
              background="subtle"
              style={{
                height: 1,
                marginLeft: 68,
              }}
            />
          )}
        </Box>
      ),
      [theme, handleModelSelect],
    )

    const renderSectionHeader = useCallback(
      ({ section }: { section: { title: string } }) => (
        <Box style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 }}>
          <Text
            size="sm"
            weight="semibold"
            mode="subtle"
            style={{
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {section.title}
          </Text>
        </Box>
      ),
      [],
    )

    const renderHeader = () => (
      <Box p="md" style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle }}>
        <Box direction="row" alignItems="center" justifyContent="space-between">
          <Box flex>
            <Text size="lg" weight="bold">
              Select Model
            </Text>
          </Box>
          <Pressable onPress={dismissSheet}>
            <Icon icon={Feather} name="x" size={20} color={theme.colors.text.subtle} />
          </Pressable>
        </Box>

        <Box mt="md">
          <Box
            style={{
              backgroundColor: theme.colors.background.subtle,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border.subtle,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
            }}
          >
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search models..."
              placeholderTextColor={theme.colors.text.subtle}
              style={{
                color: theme.colors.text.default,
                fontSize: 16,
                padding: 0,
              }}
            />
          </Box>
        </Box>
      </Box>
    )

    return (
      <BottomSheet ref={ref} snapPoints={["75%"]} enablePanDownToClose={true}>
        {renderHeader()}
        <BottomSheetSectionList
          sections={modalSections}
          renderItem={renderModel}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item: ModelWithProvider) => item.id}
          showsVerticalScrollIndicator={false}
          style={{ height: 300 }}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={() => (
            <Box flex center p="lg">
              <Text mode="subtle" size="lg">
                No models available
              </Text>
              <Text mode="subtle" size="sm" style={{ marginTop: 8, textAlign: "center" }}>
                Models will appear here once synced from the server
              </Text>
            </Box>
          )}
        />
      </BottomSheet>
    )
  }),
)

ModelsSheet.displayName = "ModelsSheet"
