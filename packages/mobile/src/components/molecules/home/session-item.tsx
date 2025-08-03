import { Box, Text, Button } from "@/components/ui/primitives"

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
    <Button
      variant="ghost"
      size="auto"
      onPress={() => onPress(session.id)}
      style={{
        paddingVertical: 12,
        paddingHorizontal: 16,
      }}
    >
      <Box direction="row" alignItems="center">
        <Box flex style={{ minWidth: 0 }}>
          <Text size="md" weight="medium" numberOfLines={1} style={{ marginBottom: 2 }}>
            {session.title}
          </Text>
          <Box direction="row" alignItems="center" gap="xs">
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

        <Box direction="row" alignItems="center" gap="xs" style={{ marginLeft: 12 }}>
          {session.shareUrl && <Text style={{ fontSize: 12 }}>🔗</Text>}
          {!session.isSynced && <Text style={{ fontSize: 12 }}>⏳</Text>}
          <Text style={{ fontSize: 12 }}>›</Text>
        </Box>
      </Box>
    </Button>
  )
}
