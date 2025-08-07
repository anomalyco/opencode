import { useState, forwardRef, useImperativeHandle, useRef, useEffect } from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"
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
import { BottomSheetModal, type BottomSheetModalRef } from "@/primitives/bottom-sheet-modal"

interface ProjectConnectionSheetProps {
  onClose: () => void
  editingProject?: Project | null
  onEditExistingProject?: (project: Project) => void
}

export interface ProjectConnectionSheetRef {
  present: () => void
  dismiss: () => void
}

export const ProjectConnectionSheet = forwardRef<ProjectConnectionSheetRef, ProjectConnectionSheetProps>(
  ({ onClose, editingProject, onEditExistingProject }, ref) => {
    const { data: activeProject } = useActiveProjectQuery()
    const { data: projects } = useProjectsQuery()
    const createProject = useCreateProjectMutation()
    const updateProject = useUpdateProjectMutation()
    const updateConnectionStatus = useUpdateProjectConnectionStatusMutation()
    const setActiveProject = useSetActiveProjectMutation()
    const deleteProject = useDeleteProjectMutation()
    const { refetch: refetchAppInfo } = useRemoteAppInfoQuery()
    const { refetch: refetchRemoteSessions } = useRemoteSessionsQuery()
    const queryClient = useQueryClient()
    const sonner = useSonner()

    const bottomSheetRef = useRef<BottomSheetModalRef>(null)

    const [projectName, setProjectName] = useState("")
    const [projectDescription, setProjectDescription] = useState("")
    const [serverUrl, setServerUrl] = useState("127.0.0.1:4096")
    const [isConnecting, setIsConnecting] = useState(false)
    const [deleteConfirmCount, setDeleteConfirmCount] = useState(0)

    // Initialize form with editing project data
    useEffect(() => {
      if (editingProject) {
        setProjectName(editingProject.name)
        setProjectDescription(editingProject.description || "")
        // Use the full server URL which includes the path
        setServerUrl(editingProject.serverUrl)
      } else {
        // Reset form for new project
        setProjectName("")
        setProjectDescription("")
        setServerUrl("127.0.0.1:4096")
      }
    }, [editingProject])

    useImperativeHandle(ref, () => ({
      present: () => bottomSheetRef.current?.present(),
      dismiss: () => bottomSheetRef.current?.dismiss(),
    }))

    const handleSaveAndConnect = async () => {
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
                    // If callback is provided, use it to edit the existing project
                    setTimeout(() => {
                      onEditExistingProject(existingProject)
                    }, 300)
                  } else {
                    // Fallback: show info message
                    setTimeout(() => {
                      sonner.info(`Please edit "${existingProject.name}" project to update its URL`)
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
              serverHostname: parsed.hostname,
              serverPort: parsed.port,
              serverUrl: parsed.fullUrl,
              path: serverProjectPath,
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
            connectionStatus: "disconnected",
            isActive: false,
            isFavorite: false,
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
    }

    const handleDisconnect = async () => {
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
    }

    const handleDelete = async () => {
      if (editingProject) {
        if (deleteConfirmCount === 0) {
          setDeleteConfirmCount(1)
          sonner.warning("Tap again to confirm deletion", { duration: 3000 })
          // Reset after 3 seconds
          setTimeout(() => setDeleteConfirmCount(0), 3000)
        } else {
          try {
            await deleteProject.mutateAsync(editingProject.id)
            sonner.success(`Deleted project "${editingProject.name}"`)
            onClose()
          } catch (error) {
            sonner.error(`Failed to delete project: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        }
      }
    }

    const isEditing = !!editingProject
    // Only show disconnect button if editing the currently active AND connected project
    const isConnected = isEditing
      ? editingProject?.id === activeProject?.id && editingProject?.connectionStatus === "connected"
      : activeProject?.connectionStatus === "connected"

    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={["70%"]}
        onDismiss={onClose}
        enablePanDownToClose
        keyboardBehavior="fillParent"
        keyboardBlurBehavior="restore"
      >
        <BottomSheetView style={{ flex: 1 }}>
          <Box p="md" gap="lg">
            <Box>
              <Text size="lg" weight="semibold">
                {isEditing ? "Edit Project" : "Add New Project"}
              </Text>
              <Text size="sm" mode="subtle">
                {isEditing ? "Update project settings" : "Connect to an OpenCode server"}
              </Text>
            </Box>

            <Box gap="md">
              <BottomSheetInput
                label="Project Name"
                value={projectName}
                onChangeText={setProjectName}
                placeholder="My OpenCode Project"
                leftAccessory={<Text>📁</Text>}
              />

              <BottomSheetInput
                label="Description (Optional)"
                value={projectDescription}
                onChangeText={setProjectDescription}
                placeholder="Brief description of this project"
                leftAccessory={<Text>📝</Text>}
              />

              <BottomSheetInput
                label="Server URL"
                value={serverUrl}
                onChangeText={setServerUrl}
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
                  <Button.Text weight="medium">
                    {isConnecting ? "Connecting..." : isEditing ? "Update & Connect" : "Create & Connect"}
                  </Button.Text>
                </Button>
              )}

              {isEditing && (
                <Button mode="error" variant="ghost" onPress={handleDelete}>
                  <Button.Icon>
                    {({ color, size }) => <Icon icon={Feather} name="trash-2" size={size} color={color} />}
                  </Button.Icon>
                  <Button.Text size="md" weight="medium">
                    {deleteConfirmCount > 0 ? "Tap Again to Delete" : "Delete Project"}
                  </Button.Text>
                </Button>
              )}

              <Button variant="ghost" onPress={onClose}>
                <Button.Icon>
                  {({ color, size }) => <Icon icon={Feather} name="x" size={size} color={color} />}
                </Button.Icon>
                <Button.Text size="md" weight="medium">
                  Cancel
                </Button.Text>
              </Button>
            </Box>

            <Box background="subtle" rounded="lg" p="md">
              <Text size="xs" mode="subtle">
                💡 Examples of valid server URLs:
              </Text>
              <Box mt="xs" background="dim" rounded="md" p="sm">
                <Text size="xs" weight="medium" mode="brand">
                  127.0.0.1:4096{"\n"}
                  https://your-domain.com{"\n"}
                  https://macbook-pro.li-piano.ts.net
                </Text>
              </Box>
            </Box>
          </Box>
        </BottomSheetView>
      </BottomSheetModal>
    )
  },
)

ProjectConnectionSheet.displayName = "ProjectConnectionSheet"
