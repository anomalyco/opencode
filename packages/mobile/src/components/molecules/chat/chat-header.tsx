import { memo } from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import BlurView from "@/components/ui/primitives/blur-view"
import { Feather } from "@expo/vector-icons"
import { useRouter } from "expo-router"

interface ChatHeaderProps {
  sessionTitle?: string
  onMenuPress?: () => void
  onNewSessionPress?: () => void
}

export const ChatHeader = memo(({ sessionTitle, onMenuPress, onNewSessionPress }: ChatHeaderProps) => {
  const router = useRouter()

  const handleBackPress = () => {
    router.back()
  }

  return (
    <BlurView
      intensity={80}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
      }}
    >
      <Box
        direction="row"
        alignItems="center"
        p="md"
        safeAreaTop
        style={{
          borderBottomWidth: 1,
          borderBottomColor: "rgba(0,0,0,0.1)",
        }}
      >
        <Button variant="ghost" onPress={handleBackPress} style={{ paddingHorizontal: 8 }}>
          <Icon icon={Feather} name="chevron-left" size={24} color="muted" />
        </Button>
        <Box
          background="lightest"
          rounded="full"
          style={{
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
          }}
        >
          <Icon icon={Feather} name="cpu" size={18} color="brand" />
        </Box>
        <Box style={{ flex: 1 }}>
          <Text size="lg" weight="semibold" numberOfLines={1}>
            {sessionTitle || "OpenCode Assistant"}
          </Text>
          <Text size="xs" mode="subtle">
            AI-powered development help
          </Text>
        </Box>
        <Box direction="row" alignItems="center" gap="xs">
          {onNewSessionPress && (
            <Button variant="ghost" onPress={onNewSessionPress}>
              <Icon icon={Feather} name="plus" size={18} color="brand" />
            </Button>
          )}
          <Button variant="ghost" onPress={onMenuPress}>
            <Icon icon={Feather} name="more-horizontal" size={20} color="muted" />
          </Button>
        </Box>
      </Box>
    </BlurView>
  )
})

ChatHeader.displayName = "ChatHeader"
