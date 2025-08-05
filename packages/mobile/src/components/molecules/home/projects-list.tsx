import { ScrollView } from "react-native"
import { Box } from "@/components/ui/primitives"
import { useProjectsQuery, useActiveProjectQuery, useSetActiveProjectMutation } from "@/services/api/local/projects"
import { ProjectCard } from "./project-card"
import { AddServerCard } from "./add-server-card"
import { ProjectCardSkeleton } from "./project-card-skeleton"

interface ProjectsListProps {
  onAddServer: () => void
  onEditProject?: (project: any) => void
}

export const ProjectsList = ({ onAddServer, onEditProject }: ProjectsListProps) => {
  const { data: projects = [], isLoading } = useProjectsQuery()
  const { data: activeProject } = useActiveProjectQuery()
  const setActiveProject = useSetActiveProjectMutation()

  const handleProjectPress = (projectId: string) => {
    if (projectId !== activeProject?.id) {
      setActiveProject.mutate(projectId)
    }
  }

  const handleProjectLongPress = (project: any) => {
    onEditProject?.(project)
  }

  if (isLoading) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        style={{ flexGrow: 0 }}
      >
        <Box direction="row" gap="md">
          <AddServerCard onPress={onAddServer} />
          {[1, 2, 3].map((i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </Box>
      </ScrollView>
    )
  }

  // Don't render anything if no projects exist (handled by ConnectionStatus)
  if (projects.length === 0) {
    return null
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16 }}
      style={{ flexGrow: 0 }}
    >
      <Box direction="row" gap="md">
        {/* Add Server Card - always first */}
        <AddServerCard onPress={onAddServer} />

        {/* Project Cards - sorted with active project first */}
        {projects
          .sort((a, b) => {
            const aIsActive = a.id === activeProject?.id
            const bIsActive = b.id === activeProject?.id
            if (aIsActive && !bIsActive) return -1
            if (!aIsActive && bIsActive) return 1
            return 0
          })
          .map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isActive={project.id === activeProject?.id}
              onPress={() => handleProjectPress(project.id)}
              onLongPress={() => handleProjectLongPress(project)}
            />
          ))}
      </Box>
    </ScrollView>
  )
}
