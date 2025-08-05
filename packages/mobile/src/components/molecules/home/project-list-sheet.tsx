import { forwardRef, useImperativeHandle, useRef, useCallback } from "react"
import { Box, Text, Button, BottomSheet, Icon } from "@/components/ui/primitives"
import type { BottomSheetRef } from "@/components/ui/primitives"
import { BottomSheetView, BottomSheetScrollView } from "@gorhom/bottom-sheet"
import { Feather } from "@expo/vector-icons"
import { useProjectsQuery, useActiveProjectQuery, useSetActiveProjectMutation } from "@/services/api/local/projects"
import type { Project } from "@/db/types"

interface ProjectListSheetProps {
  onClose: () => void
  onAddServer: () => void
  onEditProject: (project: Project) => void
}

export interface ProjectListSheetRef {
  present: () => void
  dismiss: () => void
}

export const ProjectListSheet = forwardRef<ProjectListSheetRef, ProjectListSheetProps>(
  ({ onClose, onAddServer, onEditProject }, ref) => {
    const { data: projects = [] } = useProjectsQuery()
    const { data: activeProject } = useActiveProjectQuery()
    const setActiveProject = useSetActiveProjectMutation()

    const bottomSheetRef = useRef<BottomSheetRef>(null)

    useImperativeHandle(ref, () => ({
      present: () => bottomSheetRef.current?.present(),
      dismiss: () => bottomSheetRef.current?.dismiss(),
    }))
    const handleProjectSelect = useCallback(
      async (project: Project) => {
        if (project.id !== activeProject?.id) {
          await setActiveProject.mutateAsync(project.id)
        }
        onClose()
      },
      [activeProject?.id, setActiveProject, onClose],
    )

    const getConnectionColor = (status: string): any => {
      switch (status) {
        case "connected":
          return "success"
        case "connecting":
          return "warning"
        default:
          return "error"
      }
    }

    const getConnectionIcon = (status: string): any => {
      switch (status) {
        case "connected":
          return "wifi"
        case "connecting":
          return "loader"
        default:
          return "wifi-off"
      }
    }
    return (
      <BottomSheet
        ref={bottomSheetRef}
        snapPoints={["75%"]}
        onDismiss={onClose}
        enablePanDownToClose
        keyboardBehavior="fillParent"
        keyboardBlurBehavior="restore"
      >
        <BottomSheetView style={{ flex: 1 }}>
          <Box p="md" gap="lg">
            {/* Header */}
            <Box direction="row" justifyContent="space-between" alignItems="center">
              <Text size="lg" weight="semibold">
                Servers
              </Text>
              <Button variant="ghost" size="sm" onPress={onAddServer}>
                <Box direction="row" alignItems="center" gap="xs">
                  <Icon icon={Feather} name="plus" size={16} color="brand" />
                  <Text size="sm" weight="medium" mode="brand">
                    Add Server
                  </Text>
                </Box>
              </Button>
            </Box>

            {/* Server List */}
            <BottomSheetScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <Box gap="sm">
                {projects
                  .sort((a, b) => {
                    const aIsActive = a.id === activeProject?.id
                    const bIsActive = b.id === activeProject?.id
                    if (aIsActive && !bIsActive) return -1
                    if (!aIsActive && bIsActive) return 1
                    return 0
                  })
                  .map((project) => {
                    const isActive = project.id === activeProject?.id
                    return (
                      <Box key={project.id} background="base" rounded="lg" border="subtle">
                        <Button
                          variant="ghost"
                          size="auto"
                          onPress={() => handleProjectSelect(project)}
                          style={{
                            paddingVertical: 16,
                            paddingHorizontal: 16,
                          }}
                        >
                          <Box direction="row" alignItems="center">
                            {/* Connection Status Icon */}
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
                              <Icon
                                icon={Feather}
                                name={getConnectionIcon(project.connectionStatus || "disconnected")}
                                size={20}
                                color={getConnectionColor(project.connectionStatus || "disconnected")}
                              />
                            </Box>

                            {/* Project Info */}
                            <Box flex style={{ minWidth: 0 }}>
                              <Text size="md" weight="semibold" numberOfLines={1} style={{ marginBottom: 6 }}>
                                {project.name}
                              </Text>
                              <Box direction="row" alignItems="center" gap="xs">
                                <Icon icon={Feather} name="server" size={12} color="muted" />
                                <Text size="sm" mode="subtle" numberOfLines={1}>
                                  {project.serverHostname}:{project.serverPort}
                                </Text>
                              </Box>
                            </Box>

                            {/* Status Icons */}
                            <Box direction="row" alignItems="center" gap="sm" style={{ marginLeft: 16 }}>
                              {isActive && (
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
                                  <Icon icon={Feather} name="check" size={12} color="brand" />
                                </Box>
                              )}
                              <Button
                                variant="ghost"
                                size="auto"
                                onPress={(e) => {
                                  e.stopPropagation()
                                  onEditProject(project)
                                }}
                                style={{
                                  width: 28,
                                  height: 28,
                                  padding: 0,
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Icon icon={Feather} name="settings" size={14} color="muted" />
                              </Button>
                            </Box>
                          </Box>
                        </Button>
                      </Box>
                    )
                  })}
              </Box>
            </BottomSheetScrollView>
          </Box>
        </BottomSheetView>
      </BottomSheet>
    )
  },
)

ProjectListSheet.displayName = "ProjectListSheet"
