import { memo, useState, useEffect, useCallback } from "react"
import { TextInput, Keyboard } from "react-native"
import { Box, Button, Icon } from "@/components/ui/primitives"
import BlurView from "@/components/ui/primitives/blur-view"
import { useUnistyles } from "react-native-unistyles"
import { Feather } from "@expo/vector-icons"

interface MessageInputProps {
  onSend: (content: string) => void
  disabled?: boolean
}

export const MessageInput = memo(({ onSend, disabled = false }: MessageInputProps) => {
  const [text, setText] = useState("")
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const { theme } = useUnistyles()

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

  const handleSend = useCallback(() => {
    if (text.trim() && !disabled) {
      onSend(text.trim())
      setText("")
    }
  }, [text, onSend, disabled])

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
        <Box direction="row" alignItems="flex-end" gap="sm">
          <Box flex background="dark" rounded="xl" style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <TextInput
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
})

MessageInput.displayName = "MessageInput"
