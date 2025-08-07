import { memo, useState, useEffect, useCallback, useRef, type Ref } from "react"
import { TextInput, Keyboard, Pressable } from "react-native"
import { Box, Button, Icon, Text } from "@/components/ui/primitives"
import BlurView from "@/components/ui/primitives/blur-view"
import { useUnistyles } from "react-native-unistyles"
import { Feather, Ionicons } from "@expo/vector-icons"
import { CommandButton } from "./command-button"

import type { BottomSheetRef } from "@/components/ui/primitives/bottom-sheet"
import { useLocalSessionQuery } from "@/services/api/local/sessions"
import { useSessionModelSelection } from "@/hooks/use-model-selection"
import { useSimpleChatState } from "@/hooks/use-simple-chat-state"
import { useCurrentModeQuery, useSwitchModeMutation } from "@/services/api/local/user-settings"
import { useSonner } from "@/hooks/use-sonner"

interface MessageInputProps {
  sessionId: string
  disabled?: boolean
  commandsSheetRef?: Ref<BottomSheetRef>
  modelsSheetRef?: Ref<BottomSheetRef>
}

export const MessageInput = memo(
  ({ sessionId, disabled = false, commandsSheetRef, modelsSheetRef }: MessageInputProps) => {
    const [text, setText] = useState("")
    const [keyboardVisible, setKeyboardVisible] = useState(false)
    const { theme } = useUnistyles()
    const inputRef = useRef<TextInput>(null)

    // Get current session and model selection with modal data
    const { data: session } = useLocalSessionQuery(sessionId)
    const modelSelection = useSessionModelSelection(session)

    // Get chat state and mode management
    const { sendMessage } = useSimpleChatState(sessionId)
    const { data: currentMode } = useCurrentModeQuery()
    const switchModeMutation = useSwitchModeMutation()
    const sonner = useSonner()

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
          await sendMessage(messageText, currentMode)
        } catch {
          // Restore text on error
          setText(messageText)
        }
      }
    }, [text, sendMessage, currentMode, disabled])
    const handleCommandPress = () => {
      console.log(commandsSheetRef)
      commandsSheetRef?.current?.present()
    }

    const handleShowModels = () => {
      modelsSheetRef?.current?.present()
    }

    // Handle mode toggle
    const handleModeToggle = useCallback(async () => {
      try {
        const newMode = await switchModeMutation.mutateAsync()

        // Show mode switch toast with appropriate color
        if (newMode === "build") {
          sonner.info("Switched to build mode", {
            duration: 2000,
            icon: {
              component: Ionicons,
              name: "hammer",
              size: 20,
            },
          })
        } else {
          sonner.secondary("Switched to plan mode", {
            duration: 2000,
            icon: {
              component: Ionicons,
              name: "document-text",
              size: 20,
            },
          })
        }
      } catch (err) {
        sonner.error("Failed to switch mode")
      }
    }, [switchModeMutation, sonner])
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
            <Button size="auto" variant="ghost" onPress={handleModeToggle}>
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
        </Box>
      </BlurView>
    )
  },
)

MessageInput.displayName = "MessageInput"
