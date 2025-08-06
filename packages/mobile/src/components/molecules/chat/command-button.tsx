import { memo } from "react"
import { Pressable } from "react-native"
import { Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"
import { useUnistyles } from "react-native-unistyles"

interface CommandButtonProps {
  onPress: () => void
  disabled?: boolean
}

export const CommandButton = memo(({ onPress, disabled = false }: CommandButtonProps) => {
  const { theme } = useUnistyles()

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: theme.colors.background.subtle,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
      }}
    >
      <Icon icon={Feather} name="zap" size={18} color={theme.colors.text.default} />
    </Pressable>
  )
})

CommandButton.displayName = "CommandButton"
