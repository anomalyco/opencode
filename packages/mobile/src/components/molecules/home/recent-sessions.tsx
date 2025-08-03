import { Box, Text, Button } from "@/components/ui/primitives"

interface RecentSessionsHeaderProps {
  onViewAll: () => void
}

export const RecentSessionsHeader = ({ onViewAll }: RecentSessionsHeaderProps) => {
  return (
    <Box direction="row" justifyContent="space-between" alignItems="center" mb="md">
      <Text size="md" weight="semibold">
        Recent Sessions
      </Text>
      <Button size="sm" variant="ghost" onPress={onViewAll}>
        <Button.Text>View All</Button.Text>
      </Button>
    </Box>
  )
}

export const RecentSessions = ({ onSessionPress, onViewAll }: RecentSessionsProps) => {
  const { data: sessions, isLoading } = useLocalSessionsQuery()

  const recentSessions = sessions?.slice(0, 5) || []

  if (isLoading) {
    return (
      <Box gap="md">
        <Text size="md" weight="semibold">
          Recent Sessions
        </Text>
        <Box center p="lg">
          <Box animation="pulse" animationConfig={{ repeat: 3 }}>
            <Text mode="subtle">Loading sessions...</Text>
          </Box>
        </Box>
      </Box>
    )
  }

  if (!recentSessions.length) {
    return (
      <Box gap="md">
        <Text size="md" weight="semibold">
          Recent Sessions
        </Text>
        <Box center p="lg" background="subtle" rounded="lg" border="subtle">
          <Text mode="subtle" size="sm">
            No sessions yet
          </Text>
          <Box mt="xs">
            <Text mode="subtle" size="xs">
              Create your first session to get started
            </Text>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box gap="md">
      <Box direction="row" justifyContent="space-between" alignItems="center">
        <Text size="md" weight="semibold">
          Recent Sessions
        </Text>
        <Button size="sm" variant="ghost" onPress={onViewAll}>
          <Button.Text>View All</Button.Text>
        </Button>
      </Box>

      <FlatList
        data={recentSessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <SessionItem session={item} onPress={onSessionPress} />}
        ItemSeparatorComponent={() => <Box style={{ height: 8 }} />}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      />
    </Box>
  )
}
