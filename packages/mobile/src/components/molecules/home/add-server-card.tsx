import { Box, Text, Icon } from "@/components/ui/primitives"
import AnimatedPressable from "@/components/ui/primitives/animated-pressable"
import { Feather } from "@expo/vector-icons"

interface AddServerCardProps {
  onPress: () => void
}

export const AddServerCard = ({ onPress }: AddServerCardProps) => {
  return (
    <AnimatedPressable onPress={onPress}>
      <Box background="subtle" rounded="lg" border="subtle" p="md" center gap="sm" style={{ width: 160, height: 100 }}>
        <Box background="dim" rounded="full" center style={{ width: 32, height: 32 }}>
          <Icon icon={Feather} name="plus" size={16} color="brand" />
        </Box>
        <Text size="sm" weight="medium" mode="subtle">
          Add Server
        </Text>
      </Box>
    </AnimatedPressable>
  )
}
