import React, { forwardRef, useImperativeHandle, useRef, useCallback, useState, memo } from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import { BottomSheetView, BottomSheetScrollView } from "@gorhom/bottom-sheet"
import { Feather } from "@expo/vector-icons"
import {
  useProjectsQuery,
  useActiveProjectQuery,
  useSetActiveProjectMutation,
  useUpdateProjectConnectionStatusMutation,
} from "@/services/api/local/projects"
import { useRemoteSessionsQuery } from "@/services/api/remote/sessions"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/services/api/keys"
import { apiClient } from "@/services/api/remote/client"
import type { Project } from "@/db/types"
import { BottomSheetModal, type BottomSheetModalRef } from "@/primitives/bottom-sheet-modal"

interface ProjectListSheetOptimizedProps {
  onClose: () => void
  onAddServer: () => void
  onEditProject: (project: Project) => void
}

export interface ProjectListSheetOptimizedRef {
  present: () => void
  dismiss: () => void
}

const ProjectListItem = memo<{
  project: Project
  isActive: boolean
  isConnecting: boolean
  onSelect: (project: Project) => void
  onEdit: (project: Project) => void
}>(({ project, isActive, isConnecting, onSelect, onEdit }) => {
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
    if (isConnecting) return "loader"
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
    <Box background="base" rounded="lg" border="subtle">
      <Button
        variant="ghost"
        size="auto"
        onPress={() => onSelect(project)}
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
              color={isConnecting ? "warning" : getConnectionColor(project.connectionStatus || "disconnected")}
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
                {project.serverUrl}
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
              size="sm"
              onPress={(e) => {
                e.stopPropagation()
                onEdit(project)
              }}
              style={{
                width: 28,
                height: 28,
                padding: 0,
              }}
            >
              <Icon icon={Feather} name="settings" size={12} color="muted" />
            </Button>
          </Box>
        </Box>
      </Button>
    </Box>
  )
})

ProjectListItem.displayName = "ProjectListItem"

export const ProjectListSheetOptimized = memo(
  forwardRef<ProjectListSheetOptimizedRef, ProjectListSheetOptimizedProps>(
    ({ onClose, onAddServer, onEditProject }, ref) => {
      const { data: projects = [] } = useProjectsQuery()
      const { data: activeProject } = useActiveProjectQuery()
      const setActiveProject = useSetActiveProjectMutation()
      const updateConnectionStatus = useUpdateProjectConnectionStatusMutation()
      const { refetch: refetchRemoteSessions } = useRemoteSessionsQuery()
      const queryClient = useQueryClient()

      const bottomSheetRef = useRef<BottomSheetModalRef>(null)
      const [connectingProjects, setConnectingProjects] = useState<Set<string>>(new Set())

      useImperativeHandle(ref, () => ({
        present: () => bottomSheetRef.current?.present(),
        dismiss: () => bottomSheetRef.current?.dismiss(),
      }))

      const handleProjectSelect = useCallback(
        async (project: Project) => {
          const isActive = project.id === activeProject?.id
          const isConnected = project.connectionStatus === "connected"

          // If project is already active and connected, just close the sheet
          if (isActive && isConnected) {
            onClose()
            return
          }

          try {
            setConnectingProjects((prev) => new Set(prev).add(project.id))

            if (!isActive) {
              // Switch to the project first
              await setActiveProject.mutateAsync(project.id)
            }

            // Connect/reconnect to the project
            await updateConnectionStatus.mutateAsync({
              projectId: project.id,
              status: "connecting",
            })

            // Update API client base URL and test connection
            await apiClient.updateBaseUrlFromString(project.serverUrl)
            await apiClient.ping()

            // Set status to connected on success
            await updateConnectionStatus.mutateAsync({
              projectId: project.id,
              status: "connected",
            })

            // Fetch remote sessions and invalidate local queries
            await refetchRemoteSessions()
            queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
          } catch (error) {
            // Set status to disconnected on failure
            await updateConnectionStatus.mutateAsync({
              projectId: project.id,
              status: "disconnected",
            })
          } finally {
            setConnectingProjects((prev) => {
              const newSet = new Set(prev)
              newSet.delete(project.id)
              return newSet
            })
          }

          onClose()
        },
        [activeProject?.id, setActiveProject, updateConnectionStatus, refetchRemoteSessions, queryClient, onClose],
      )

      const sortedProjects = projects.sort((a, b) => {
        const aIsActive = a.id === activeProject?.id
        const bIsActive = b.id === activeProject?.id
        if (aIsActive && !bIsActive) return -1
        if (!aIsActive && bIsActive) return 1
        return 0
      })

      return (
        <BottomSheetModal
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
                  {sortedProjects.map((project) => (
                    <ProjectListItem
                      key={project.id}
                      project={project}
                      isActive={project.id === activeProject?.id}
                      isConnecting={connectingProjects.has(project.id)}
                      onSelect={handleProjectSelect}
                      onEdit={onEditProject}
                    />
                  ))}
                </Box>
              </BottomSheetScrollView>
            </Box>
          </BottomSheetView>
        </BottomSheetModal>
      )
    },
  ),
)

ProjectListSheetOptimized.displayName = "ProjectListSheetOptimized"
