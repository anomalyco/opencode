import { Box, Text, Icon, Button } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface RecentSessionsHeaderProps {
  onViewAll?: () => void
}

export const RecentSessionsHeader = ({ onViewAll }: RecentSessionsHeaderProps) => {
  return (
    <Box direction="row" alignItems="center" justifyContent="space-between" mb="md">
      <Box direction="row" alignItems="center" gap="xs">
        <Icon icon={Feather} name="clock" size={18} color="primary" />
        <Text size="md" weight="semibold">
          Recent Sessions
        </Text>
      </Box>

      {onViewAll && (
        <Button variant="ghost" size="sm" onPress={onViewAll}>
          <Button.Text size="sm" mode="subtle">
            View All
          </Button.Text>
        </Button>
      )}
    </Box>
  )
}
