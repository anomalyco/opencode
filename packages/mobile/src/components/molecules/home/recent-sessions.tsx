import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface RecentSessionsHeaderProps {
  onViewAll: () => void
}

export const RecentSessionsHeader = ({ onViewAll }: RecentSessionsHeaderProps) => {
  return (
    <Box direction="row" justifyContent="space-between" alignItems="center" mb="md">
      <Box direction="row" alignItems="center" gap="xs">
        <Icon icon={Feather} name="clock" size={18} color="primary" />
        <Text size="md" weight="semibold">
          Recent Sessions
        </Text>
      </Box>
      <Button variant="ghost" onPress={onViewAll}>
        <Button.Icon>
          <Icon icon={Feather} name="arrow-right" size={14} />
        </Button.Icon>
        <Button.Text>View All</Button.Text>
      </Button>
    </Box>
  )
}
