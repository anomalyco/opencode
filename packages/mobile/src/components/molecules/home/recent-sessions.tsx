import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

export const RecentSessionsHeader = () => {
  return (
    <Box direction="row" alignItems="center" gap="xs" mb="md">
      <Icon icon={Feather} name="clock" size={18} color="primary" />
      <Text size="md" weight="semibold">
        Recent Sessions
      </Text>
    </Box>
  )
}
