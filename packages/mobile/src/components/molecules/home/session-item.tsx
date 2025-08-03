import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface SessionItemProps {
  session: {
    id: string
    title: string
    timeUpdated: Date
    shareUrl?: string | null
    isSynced?: boolean | null
  }
  onPress: (sessionId: string) => void
}

export const SessionItem = ({ session, onPress }: SessionItemProps) => {
  return (
    <Box
      background="base"
      rounded="lg"
      border="subtle"
      style={{
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
      }}
    >
      <Button
        variant="ghost"
        size="auto"
        onPress={() => onPress(session.id)}
        style={{
          paddingVertical: 16,
          paddingHorizontal: 16,
        }}
      >
        <Box direction="row" alignItems="center">
          {/* Enhanced Icon Container */}
          <Box
            background="lightest"
            rounded="lg"
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 16,
            }}
          >
            <Icon icon={Feather} name="message-circle" size={20} color="brand" />
          </Box>

          {/* Content */}
          <Box flex style={{ minWidth: 0 }}>
            <Text size="md" weight="semibold" numberOfLines={1} style={{ marginBottom: 6 }}>
              {session.title}
            </Text>
            <Box direction="row" alignItems="center" gap="xs">
              <Icon icon={Feather} name="clock" size={12} color="muted" />
              <Text size="sm" mode="subtle">
                {new Date(session.timeUpdated).toLocaleDateString()}
              </Text>
              <Text size="sm" mode="subtle">
                •
              </Text>
              <Text size="sm" mode="subtle">
                {new Date(session.timeUpdated).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </Box>
          </Box>

          {/* Status Icons */}
          <Box direction="row" alignItems="center" gap="sm" style={{ marginLeft: 16 }}>
            {session.shareUrl && (
              <Box
                background="subtle"
                rounded="full"
                style={{
                  width: 28,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon icon={Feather} name="share-2" size={12} color="brand" />
              </Box>
            )}
            {!session.isSynced && (
              <Box
                animation="pulse"
                animationConfig={{ repeat: -1 }}
                background="subtle"
                rounded="full"
                style={{
                  width: 28,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon icon={Feather} name="upload-cloud" size={12} color="warning" />
              </Box>
            )}
            <Icon icon={Feather} name="chevron-right" size={18} color="muted" />
          </Box>
        </Box>
      </Button>
    </Box>
  )
}
