import { memo } from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import BlurView from "@/components/ui/primitives/blur-view"
import { Feather } from "@expo/vector-icons"

interface ChatHeaderProps {
  sessionTitle?: string
  onMenuPress?: () => void
}

export const ChatHeader = memo(({ sessionTitle, onMenuPress }: ChatHeaderProps) => {
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
        justifyContent="space-between"
        alignItems="center"
        p="md"
        safeAreaTop
        style={{
          borderBottomWidth: 1,
          borderBottomColor: "rgba(0,0,0,0.1)",
        }}
      >
        <Box flex direction="row" alignItems="center" gap="sm">
          <Box
            background="lightest"
            rounded="full"
            style={{
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon={Feather} name="cpu" size={18} color="brand" />
          </Box>
          <Box flex>
            <Text size="lg" weight="semibold" numberOfLines={1}>
              {sessionTitle || "OpenCode Assistant"}
            </Text>
            <Text size="xs" mode="subtle">
              AI-powered development help
            </Text>
          </Box>
        </Box>
        <Button variant="ghost" onPress={onMenuPress}>
          <Icon icon={Feather} name="more-horizontal" size={20} color="muted" />
        </Button>
      </Box>
    </BlurView>
  )
})

ChatHeader.displayName = "ChatHeader"
