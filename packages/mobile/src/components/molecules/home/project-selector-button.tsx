import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import { useActiveProjectQuery, useProjectsQuery } from "@/services/api/local/projects"
import { Feather } from "@expo/vector-icons"

interface ProjectSelectorButtonProps {
  onPress: () => void
}

export const ProjectSelectorButton = ({ onPress }: ProjectSelectorButtonProps) => {
  const { data: activeProject } = useActiveProjectQuery()
  const { data: projects = [] } = useProjectsQuery()

  const getConnectionColor = () => {
    if (!activeProject) return "muted"
    switch (activeProject.connectionStatus) {
      case "connected":
        return "success"
      case "connecting":
        return "warning"
      default:
        return "error"
    }
  }

  // If no projects exist, show "Add Server" button
  if (projects.length === 0) {
    return (
      <Button variant="outline" size="sm" onPress={onPress}>
        <Box direction="row" alignItems="center" gap="xs">
          <Icon icon={Feather} name="plus" size={16} color="brand" />
          <Text size="sm" weight="medium">
            Add Server
          </Text>
        </Box>
      </Button>
    )
  }

  return (
    <Button variant="ghost" size="sm" onPress={onPress}>
      <Box direction="row" alignItems="center" gap="xs">
        <Icon icon={Feather} name="server" size={16} color={getConnectionColor()} />
        <Text size="sm" weight="medium" numberOfLines={1}>
          {activeProject?.name || "No Project"}
        </Text>
        <Icon icon={Feather} name="chevron-down" size={14} color="muted" />
      </Box>
    </Button>
  )
}
