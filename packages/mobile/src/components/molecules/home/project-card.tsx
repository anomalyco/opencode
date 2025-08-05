import { Box, Text, Icon } from "@/components/ui/primitives"
import AnimatedPressable from "@/components/ui/primitives/animated-pressable"
import { Feather } from "@expo/vector-icons"
import type { Project } from "@/db/types"

interface ProjectCardProps {
  project: Project
  isActive: boolean
  onPress: () => void
  onLongPress?: () => void
}

export const ProjectCard = ({ project, isActive, onPress, onLongPress }: ProjectCardProps) => {
  const getConnectionColor = () => {
    switch (project.connectionStatus) {
      case "connected":
        return "success"
      case "connecting":
        return "warning"
      default:
        return "error"
    }
  }

  const getConnectionIcon = () => {
    switch (project.connectionStatus) {
      case "connected":
        return "wifi"
      case "connecting":
        return "loader"
      default:
        return "wifi-off"
    }
  }

  return (
    <AnimatedPressable onPress={onPress} onLongPress={onLongPress}>
      <Box
        background={isActive ? "emphasis" : "subtle"}
        rounded="lg"
        border="subtle"
        p="md"
        gap="sm"
        style={{
          width: 160,
          height: 100,
          ...(isActive && { borderColor: "#007AFF", borderWidth: 2 }),
        }}
      >
        <Box direction="row" justifyContent="space-between" alignItems="center">
          <Icon icon={Feather} name={getConnectionIcon()} size={16} color={getConnectionColor()} />
          {isActive && (
            <Box background="emphasis" rounded="full" style={{ width: 6, height: 6, backgroundColor: "#007AFF" }} />
          )}
        </Box>

        <Box flex justifyContent="space-between">
          <Text size="sm" weight="semibold" numberOfLines={1} inverse={isActive}>
            {project.name}
          </Text>

          <Box>
            <Text size="xs" mode="subtle" numberOfLines={1} inverse={isActive}>
              {project.serverHostname}:{project.serverPort}
            </Text>
            {project.description && (
              <Text size="xs" mode="subtle" numberOfLines={1} inverse={isActive}>
                {project.description}
              </Text>
            )}
          </Box>
        </Box>
      </Box>
    </AnimatedPressable>
  )
}
