import React, { useState, forwardRef, useImperativeHandle, useRef, useEffect, useCallback, memo } from "react"
import { Box, Text, Button, BottomSheet, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"
import type { BottomSheetRef } from "@/components/ui/primitives"
import { BottomSheetView } from "@gorhom/bottom-sheet"
import { BottomSheetInput } from "./bottom-sheet-input"
import {
  useActiveProjectQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useUpdateProjectConnectionStatusMutation,
  useSetActiveProjectMutation,
  useDeleteProjectMutation,
  useProjectsQuery,
} from "@/services/api/local/projects"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"
import { useRemoteSessionsQuery } from "@/services/api/remote/sessions"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/services/api/keys"
import { apiClient } from "@/services/api/remote/client"
import type { Project } from "@/db/types"
import { parseServerUrl } from "@/utils/url"
import { useSonner } from "@/hooks/use-sonner"

interface ProjectConnectionSheetOptimizedProps {
  onClose: () => void
  editingProject?: Project | null
  onEditExistingProject?: (project: Project) => void
}

export interface ProjectConnectionSheetOptimizedRef {
  present: () => void
  dismiss: () => void
}

// Memoized input components to prevent re-renders
const MemoizedBottomSheetInput = memo(BottomSheetInput)

export const ProjectConnectionSheetOptimized = memo(
  forwardRef<ProjectConnectionSheetOptimizedRef, ProjectConnectionSheetOptimizedProps>(
    ({ onClose, editingProject, onEditExistingProject }, ref) => {
      const bottomSheetRef = useRef<BottomSheetRef>(null)

      // Local state for form inputs - memoized to prevent re-renders
      const [projectName, setProjectName] = useState("")
      const [projectDescription, setProjectDescription] = useState("")
      const [serverUrl, setServerUrl] = useState("127.0.0.1:4096")
      const [isConnecting, setIsConnecting] = useState(false)
      const [deleteConfirmCount, setDeleteConfirmCount] = useState(0)

      // Only load queries when actually needed
      const { data: activeProject } = useActiveProjectQuery()
      const { data: projects } = useProjectsQuery()

      // Memoized callbacks for input handlers
      const handleProjectNameChange = useCallback((text: string) => {
        setProjectName(text)
      }, [])

      const handleProjectDescriptionChange = useCallback((text: string) => {
        setProjectDescription(text)
      }, [])

      const handleServerUrlChange = useCallback((text: string) => {
        setServerUrl(text)
      }, [])

      // Initialize form with editing project data
      useEffect(() => {
        if (editingProject) {
          setProjectName(editingProject.name)
          setProjectDescription(editingProject.description || "")
          setServerUrl(editingProject.serverUrl)
        } else {
          setProjectName("")
          setProjectDescription("")
          setServerUrl("127.0.0.1:4096")
        }
      }, [editingProject])

      useImperativeHandle(ref, () => ({
        present: () => bottomSheetRef.current?.present(),
        dismiss: () => bottomSheetRef.current?.dismiss(),
      }))

      // Lazy load mutations only when needed
      const createProject = useCreateProjectMutation()
      const updateProject = useUpdateProjectMutation()
      const updateConnectionStatus = useUpdateProjectConnectionStatusMutation()
      const setActiveProject = useSetActiveProjectMutation()
      const deleteProject = useDeleteProjectMutation()
      const { refetch: refetchAppInfo } = useRemoteAppInfoQuery()
      const { refetch: refetchRemoteSessions } = useRemoteSessionsQuery()
      const queryClient = useQueryClient()
      const sonner = useSonner()

      const handleSaveAndConnect = useCallback(async () => {
        if (!projectName.trim()) return

        setIsConnecting(true)
        let project: Project | undefined

        try {
          const parsed = parseServerUrl(serverUrl)

          // Update the API client with new connection first
          await apiClient.updateBaseUrlFromString(parsed.fullUrl)

          // Test connection and get server's project info
          const appInfo = await apiClient.ping()
          const serverProjectPath =
            appInfo.path?.root || appInfo.path?.cwd || `/${projectName.toLowerCase().replace(/\s+/g, "-")}`

          // Check if a project with the same path already exists (only for new projects)
          if (!editingProject && projects) {
            const existingProject = projects.find((p) => p.path === serverProjectPath)
            if (existingProject) {
              sonner.warning(
                `A project "${existingProject.name}" already exists for this server path. Tap to update its URL instead.`,
                {
                  duration: 8000,
                  persistent: true,
                  onPress: () => {
                    onClose()
                    if (onEditExistingProject) {
                      setTimeout(() => {
                        onEditExistingProject(existingProject)
                      }, 300)
                    }
                  },
                },
              )
              return
            }
          }

          if (editingProject) {
            // Update existing project
            const [updatedProject] = await updateProject.mutateAsync({
              id: editingProject.id,
              updates: {
                name: projectName,
                description: projectDescription || null,
                serverUrl: parsed.fullUrl,
                serverHostname: parsed.hostname,
                serverPort: parsed.port,
                // Update app info from server
                appHostname: appInfo.hostname,
                appGit: appInfo.git,
                appPathConfig: appInfo.path?.config,
                appPathData: appInfo.path?.data,
                appPathRoot: appInfo.path?.root,
                appPathCwd: appInfo.path?.cwd,
                appPathState: appInfo.path?.state,
                appTimeInitialized: appInfo.time?.initialized ? new Date(appInfo.time.initialized) : null,
              },
            })
            project = updatedProject
          } else {
            // Create new project
            const [newProject] = await createProject.mutateAsync({
              name: projectName,
              description: projectDescription || null,
              path: serverProjectPath,
              serverUrl: parsed.fullUrl,
              serverHostname: parsed.hostname,
              serverPort: parsed.port,
              // Store app info from server
              appHostname: appInfo.hostname,
              appGit: appInfo.git,
              appPathConfig: appInfo.path?.config,
              appPathData: appInfo.path?.data,
              appPathRoot: appInfo.path?.root,
              appPathCwd: appInfo.path?.cwd,
              appPathState: appInfo.path?.state,
              appTimeInitialized: appInfo.time?.initialized ? new Date(appInfo.time.initialized) : null,
            })
            project = newProject
          }

          // Set as active project
          await setActiveProject.mutateAsync(project.id)

          // Connection was already tested above, mark as connected
          updateConnectionStatus.mutate({
            projectId: project.id,
            status: "connected",
          })

          // Small delay to ensure mutation completes, then fetch remote data and refresh local queries
          await new Promise((resolve) => setTimeout(resolve, 100))

          // Fetch remote sessions to sync with server
          await refetchRemoteSessions()

          // Refresh app info
          await refetchAppInfo()

          // Invalidate local session queries to refresh home screen
          queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.all })

          onClose()
        } catch (error) {
          console.error("Connection failed:", error)

          // Update connection status to disconnected for both new and existing projects
          const projectToUpdate = editingProject || project
          if (projectToUpdate) {
            updateConnectionStatus.mutate({
              projectId: projectToUpdate.id,
              status: "disconnected",
            })
          }

          // Show error to user
          sonner.error(`Failed to connect to server: ${error instanceof Error ? error.message : "Unknown error"}`)
        } finally {
          setIsConnecting(false)
        }
      }, [
        projectName,
        serverUrl,
        projectDescription,
        editingProject,
        projects,
        createProject,
        updateProject,
        setActiveProject,
        updateConnectionStatus,
        refetchRemoteSessions,
        refetchAppInfo,
        queryClient,
        sonner,
        onClose,
        onEditExistingProject,
      ])

      const handleDisconnect = useCallback(async () => {
        if (activeProject) {
          updateConnectionStatus.mutate({
            projectId: activeProject.id,
            status: "disconnected",
          })
          // Small delay to ensure mutation completes, then refetch
          await new Promise((resolve) => setTimeout(resolve, 100))
          await refetchAppInfo()
          onClose()
        }
      }, [activeProject, updateConnectionStatus, refetchAppInfo, onClose])

      const handleDelete = useCallback(async () => {
        if (!editingProject) return

        if (deleteConfirmCount === 0) {
          setDeleteConfirmCount(1)
          sonner.warning("Tap delete again to confirm. This will permanently delete the project and all its data.")
          // Reset confirmation after 3 seconds
          setTimeout(() => setDeleteConfirmCount(0), 3000)
          return
        }

        try {
          await deleteProject.mutateAsync(editingProject.id)
          sonner.success("Project deleted successfully")
          onClose()
        } catch (error) {
          sonner.error(`Failed to delete project: ${error instanceof Error ? error.message : "Unknown error"}`)
        }
      }, [editingProject, deleteConfirmCount, deleteProject, sonner, onClose])

      const isConnected = activeProject?.connectionStatus === "connected"
      const isEditing = !!editingProject

      return (
        <BottomSheet
          ref={bottomSheetRef}
          snapPoints={["70%"]}
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
                  {isEditing ? "Edit Server" : "Add Server"}
                </Text>
                <Button variant="ghost" size="sm" onPress={onClose}>
                  <Icon icon={Feather} name="x" size={20} color="muted" />
                </Button>
              </Box>

              {/* Form */}
              <Box gap="md">
                <MemoizedBottomSheetInput
                  label="Project Name"
                  value={projectName}
                  onChangeText={handleProjectNameChange}
                  placeholder="My Awesome Project"
                  leftAccessory={<Text>📁</Text>}
                />

                <MemoizedBottomSheetInput
                  label="Description (Optional)"
                  value={projectDescription}
                  onChangeText={handleProjectDescriptionChange}
                  placeholder="Brief description of this project"
                  leftAccessory={<Text>📝</Text>}
                />

                <MemoizedBottomSheetInput
                  label="Server URL"
                  value={serverUrl}
                  onChangeText={handleServerUrlChange}
                  placeholder="127.0.0.1:4096 or https://your-domain.com"
                  leftAccessory={<Text>🔗</Text>}
                />
              </Box>

              <Box gap="sm">
                {isConnected && isEditing ? (
                  <Button mode="error" onPress={handleDisconnect}>
                    <Button.Icon>
                      {({ color, size }) => <Icon icon={Feather} name="wifi-off" size={size} color={color} />}
                    </Button.Icon>
                    <Button.Text size="md" weight="medium">
                      Disconnect
                    </Button.Text>
                  </Button>
                ) : (
                  <Button
                    mode="brand"
                    onPress={handleSaveAndConnect}
                    loading={isConnecting}
                    disabled={!projectName.trim()}
                    size="lg"
                  >
                    <Button.Icon>
                      {({ color, size }) => (
                        <Icon
                          icon={Feather}
                          name={isConnecting ? "loader" : isEditing ? "refresh-cw" : "wifi"}
                          size={size}
                          color={color}
                        />
                      )}
                    </Button.Icon>
                    <Button.Text size="md" weight="medium">
                      {isConnecting ? "Connecting..." : isEditing ? "Update & Connect" : "Create & Connect"}
                    </Button.Text>
                  </Button>
                )}

                {isEditing && (
                  <Button
                    mode="error"
                    variant="ghost"
                    onPress={handleDelete}
                    style={{
                      backgroundColor: deleteConfirmCount > 0 ? "rgba(239, 68, 68, 0.1)" : "transparent",
                    }}
                  >
                    <Button.Icon>
                      {({ color, size }) => <Icon icon={Feather} name="trash-2" size={size} color={color} />}
                    </Button.Icon>
                    <Button.Text size="md" weight="medium">
                      {deleteConfirmCount > 0 ? "Confirm Delete" : "Delete Project"}
                    </Button.Text>
                  </Button>
                )}
              </Box>
            </Box>
          </BottomSheetView>
        </BottomSheet>
      )
    },
  ),
)

ProjectConnectionSheetOptimized.displayName = "ProjectConnectionSheetOptimized"
