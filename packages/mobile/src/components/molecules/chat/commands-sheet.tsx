import { memo, forwardRef, useCallback, useState } from "react"
import { Pressable, ActivityIndicator } from "react-native"
import { BottomSheetFlatList } from "@gorhom/bottom-sheet"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { BottomSheet, type BottomSheetRef } from "@/components/ui/primitives/bottom-sheet"
import { MOBILE_COMMANDS, type Command } from "@/types/commands"
import { useUnistyles } from "react-native-unistyles"
import { useLocalModelsQuery } from "@/services/api/local/models"
import { useShareRemoteSessionMutation, useSummarizeRemoteSessionMutation } from "@/services/api/remote/sessions"
import { apiClient } from "@/services/api/remote/client"
import { Feather } from "@expo/vector-icons"
import { useSonner } from "@/hooks/use-sonner"
import * as Clipboard from "expo-clipboard"

interface CommandsSheetProps {
  sessionId: string
  onShowModels: () => void
}

export const CommandsSheet = memo(
  forwardRef<BottomSheetRef, CommandsSheetProps>(({ sessionId, onShowModels }, ref) => {
    const { theme, rt } = useUnistyles()
    const sonner = useSonner()
    const [loadingCommand, setLoadingCommand] = useState<string | null>(null)

    // Fetch local models for compact command
    const { data: localModels } = useLocalModelsQuery()

    // API mutations
    const shareSessionMutation = useShareRemoteSessionMutation()
    const summarizeSessionMutation = useSummarizeRemoteSessionMutation()

    const dismissSheet = () => {
      if (ref && typeof ref === "object" && ref.current) {
        ref.current.dismiss()
      }
    }

    const handleCommandPress = useCallback(async (command: Command) => {
      setLoadingCommand(command.id)
      try {
        switch (command.action) {
          case "share":
            const shareResult = await shareSessionMutation.mutateAsync(sessionId)

            if (shareResult.share?.url) {
              await Clipboard.setStringAsync(shareResult.share.url)
              sonner.success("Share URL copied to clipboard!")
            } else {
              sonner.error("Failed to get share URL")
            }
            dismissSheet()
            break

          case "compact":
            // Get first available model for summarization
            const firstModel = localModels?.[0]

            if (!firstModel) {
              sonner.error("No models available for summarization")
              dismissSheet()
              break
            }

            await summarizeSessionMutation.mutateAsync({
              id: sessionId,
              providerID: firstModel.providerId,
              modelID: firstModel.id.split(":")[1], // Remove provider prefix
            })
            sonner.success("Session summarized successfully!")
            dismissSheet()
            break

          case "help":
            await apiClient.axios.post("/tui/open-help")
            sonner.info("Help opened in TUI")
            dismissSheet()
            break

          case "models":
            dismissSheet()
            onShowModels()
            break
        }
      } catch {
        sonner.error("Command failed to execute")
        dismissSheet()
      } finally {
        setLoadingCommand(null)
      }
    }, [])

    const renderCommand = useCallback(
      ({ item, index }: { item: Command; index: number }) => (
        <Box
          background="lightest"
          style={{
            marginHorizontal: 16,
            borderTopLeftRadius: index === 0 ? 12 : 0,
            borderTopRightRadius: index === 0 ? 12 : 0,
            borderBottomLeftRadius: index === MOBILE_COMMANDS.length - 1 ? 12 : 0,
            borderBottomRightRadius: index === MOBILE_COMMANDS.length - 1 ? 12 : 0,
            overflow: "hidden",
          }}
        >
          <Pressable
            onPress={() => handleCommandPress(item)}
            disabled={loadingCommand !== null}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              opacity: loadingCommand !== null && loadingCommand !== item.id ? 0.5 : 1,
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
                <Icon icon={Feather} name={item.icon as any} size={20} color={theme.colors.text.default} />
              </Box>

              {/* Content */}
              <Box flex>
                <Text weight="medium">{item.name}</Text>
                <Text size="sm" style={{ color: theme.colors.text.subtle, marginTop: 2 }}>
                  {item.description}
                </Text>
              </Box>

              {/* Right Arrow or Loading */}
              <Box style={{ marginLeft: 12 }}>
                {loadingCommand === item.id ? (
                  <ActivityIndicator size="small" color={theme.colors.text.subtle} />
                ) : (
                  <Icon icon={Feather} name="chevron-right" size={16} color={theme.colors.text.subtle} />
                )}
              </Box>
            </Box>
          </Pressable>
          {index < MOBILE_COMMANDS.length - 1 && (
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
      [theme, handleCommandPress, loadingCommand],
    )

    const renderHeader = () => (
      <Box p="md" style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle }}>
        <Box direction="row" alignItems="center" justifyContent="space-between">
          <Box flex>
            <Text size="lg" weight="bold">
              Commands
            </Text>
          </Box>
          <Pressable onPress={dismissSheet}>
            <Icon icon={Feather} name="x" size={20} color={theme.colors.text.subtle} />
          </Pressable>
        </Box>
      </Box>
    )

    return (
      <BottomSheet ref={ref} snapPoints={["50%"]} enablePanDownToClose={true} keyboardBehavior="fillParent">
        {renderHeader()}
        <BottomSheetFlatList
          data={MOBILE_COMMANDS}
          renderItem={renderCommand}
          keyExtractor={(item: Command) => item.id}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: rt.insets.bottom + 50 }}
          ListHeaderComponent={() => (
            <Box pl="md" pr="md" pb="sm" pt="md">
              <Text
                size="sm"
                weight="semibold"
                mode="subtle"
                style={{
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                ACTIONS
              </Text>
            </Box>
          )}
        />
      </BottomSheet>
    )
  }),
)

CommandsSheet.displayName = "CommandsSheet"
