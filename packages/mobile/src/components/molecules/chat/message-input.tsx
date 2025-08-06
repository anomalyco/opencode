import { memo, useState, useEffect, useCallback, useRef } from "react"
import { TextInput, Keyboard, Pressable } from "react-native"
import { Box, Button, Icon, Text } from "@/components/ui/primitives"
import BlurView from "@/components/ui/primitives/blur-view"
import { useUnistyles } from "react-native-unistyles"
import { Feather } from "@expo/vector-icons"
import { CommandButton } from "./command-button"
import { CommandsSheet } from "./commands-sheet"
import { ModelsSheet } from "./models-sheet"
import type { BottomSheetRef } from "@/components/ui/primitives/bottom-sheet"
import type { ModelWithProvider } from "@/types/commands"
import { useLocalSessionQuery } from "@/services/api/local/sessions"
import { useSessionModelSelection } from "@/hooks/use-model-selection"

interface MessageInputProps {
  onSend: (content: string) => Promise<void>
  disabled?: boolean
  currentMode?: string
  sessionId: string
  onModeToggle?: () => void
}

export const MessageInput = memo(
  ({ onSend, disabled = false, currentMode, sessionId, onModeToggle }: MessageInputProps) => {
    const [text, setText] = useState("")
    const [keyboardVisible, setKeyboardVisible] = useState(false)
    const { theme } = useUnistyles()
    const inputRef = useRef<TextInput>(null)
    const commandsSheetRef = useRef<BottomSheetRef>(null)
    const modelsSheetRef = useRef<BottomSheetRef>(null)

    // Get current session and model selection with modal data
    const { data: session } = useLocalSessionQuery(sessionId)
    const modelSelection = useSessionModelSelection(session)

    useEffect(() => {
      const keyboardDidShowListener = Keyboard.addListener("keyboardDidShow", () => {
        setKeyboardVisible(true)
      })
      const keyboardDidHideListener = Keyboard.addListener("keyboardDidHide", () => {
        setKeyboardVisible(false)
      })

      return () => {
        keyboardDidHideListener?.remove()
        keyboardDidShowListener?.remove()
      }
    }, [])

    const handleSend = useCallback(async () => {
      if (text.trim() && !disabled) {
        const messageText = text.trim()
        setText("") // Clear immediately
        try {
          await onSend(messageText)
        } catch {
          // Restore text on error
          setText(messageText)
        }
      }
    }, [text, onSend, disabled])

    const handleCommandPress = () => {
      commandsSheetRef.current?.present()
    }

    const handleShowModels = () => {
      modelsSheetRef.current?.present()
    }

    const handleModelSelect = async (_model: ModelWithProvider) => {
      // Model selection is now handled in the ModelsSheet component
      // This callback is optional and can be used for additional actions
    }

    return (
      <BlurView
        intensity={80}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10,
        }}
      >
        <Box p="sm" safeAreaBottom={!keyboardVisible}>
          {/* Mode indicator box */}
          <Box direction="row" alignItems="center" justifyContent="space-between" mb="sm" pl="xs" pr="xs">
            {/* Mode badge */}
            <Button size="auto" variant="ghost" onPress={onModeToggle}>
              <Box mode={currentMode === "plan" ? "secondary" : "brand"} rounded="full" pl="sm" pr="sm" pt="xs" pb="xs">
                <Text
                  size="xs"
                  weight="medium"
                  mode={currentMode === "plan" ? "subtle" : "brand"}
                  style={{ textTransform: "uppercase", letterSpacing: 0.5 }}
                >
                  {currentMode === "plan" ? "Plan" : "Build"}
                </Text>
              </Box>
            </Button>

            {/* Current modal name */}
            {modelSelection.modelId && (
              <Button size="auto" variant="ghost" onPress={handleShowModels}>
                <Box mode={"brand"} rounded="full" pl="sm" pr="sm" pt="xs" pb="xs" direction="row">
                  <Text size="xs" mode="subtle">
                    {modelSelection.providerId}:{" "}
                  </Text>
                  <Text size="xs" mode="brand" weight="medium">
                    {modelSelection.modelId}
                  </Text>
                </Box>
              </Button>
            )}
          </Box>

          <Box direction="row" alignItems="flex-end" gap="sm">
            <CommandButton onPress={handleCommandPress} disabled={disabled} />
            <Pressable
              style={{ flex: 1 }}
              onPress={() => inputRef.current?.focus()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Box
                flex
                background="lightest"
                rounded="lg"
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderWidth: 0.1,
                  borderColor: "transparent",
                }}
              >
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={setText}
                  placeholder="Type a message..."
                  placeholderTextColor={theme.colors.text.subtle}
                  multiline
                  editable={!disabled}
                  style={{
                    color: theme.colors.text.default,
                    fontSize: 16,
                    maxHeight: 100,
                    paddingVertical: 0,
                  }}
                />
              </Box>
            </Pressable>
            <Button
              size="auto"
              mode="brand"
              disabled={!text.trim() || disabled}
              onPress={handleSend}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                padding: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon icon={Feather} name="arrow-up" size={18} />
            </Button>
          </Box>
          <CommandsSheet ref={commandsSheetRef} sessionId={sessionId} onShowModels={handleShowModels} />
          <ModelsSheet ref={modelsSheetRef} sessionId={sessionId} onModelSelect={handleModelSelect} />
        </Box>
      </BlurView>
    )
  },
)

MessageInput.displayName = "MessageInput"
