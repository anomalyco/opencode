import { useState, forwardRef, useImperativeHandle, useRef, useEffect } from "react"
import { Box, Text, Button, BottomSheet } from "@/components/ui/primitives"
import type { BottomSheetRef } from "@/components/ui/primitives"
import { BottomSheetView } from "@gorhom/bottom-sheet"
import { BottomSheetInput } from "./bottom-sheet-input"
import {
  useActiveProjectQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useUpdateProjectConnectionStatusMutation,
  useSetActiveProjectMutation,
} from "@/services/api/local/projects"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"
import { apiClient } from "@/services/api/remote/client"
import type { Project } from "@/db/types"

interface ProjectConnectionSheetProps {
  onClose: () => void
  editingProject?: Project | null
}

export interface ProjectConnectionSheetRef {
  present: () => void
  dismiss: () => void
}

export const ProjectConnectionSheet = forwardRef<ProjectConnectionSheetRef, ProjectConnectionSheetProps>(
  ({ onClose, editingProject }, ref) => {
    const { data: activeProject } = useActiveProjectQuery()
    const createProject = useCreateProjectMutation()
    const updateProject = useUpdateProjectMutation()
    const updateConnectionStatus = useUpdateProjectConnectionStatusMutation()
    const setActiveProject = useSetActiveProjectMutation()
    const { refetch: refetchAppInfo } = useRemoteAppInfoQuery()

    const bottomSheetRef = useRef<BottomSheetRef>(null)

    const [projectName, setProjectName] = useState("")
    const [projectDescription, setProjectDescription] = useState("")
    const [hostname, setHostname] = useState("127.0.0.1")
    const [port, setPort] = useState("4096")
    const [isConnecting, setIsConnecting] = useState(false)

    // Initialize form with editing project data
    useEffect(() => {
      if (editingProject) {
        setProjectName(editingProject.name)
        setProjectDescription(editingProject.description || "")
        setHostname(editingProject.serverHostname)
        setPort(editingProject.serverPort.toString())
      } else {
        // Reset form for new project
        setProjectName("")
        setProjectDescription("")
        setHostname("127.0.0.1")
        setPort("4096")
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
        const serverUrl = `http://${hostname}:${port}`
        const projectPath = `/${projectName.toLowerCase().replace(/\s+/g, "-")}`

        if (editingProject) {
          // Update existing project
          console.log("Updating existing project:", editingProject.id)
          const [updatedProject] = await updateProject.mutateAsync({
            id: editingProject.id,
            updates: {
              name: projectName,
              description: projectDescription || null,
              serverHostname: hostname,
              serverPort: parseInt(port),
              serverUrl,
              path: projectPath,
            },
          })
          project = updatedProject
        } else {
          // Create new project
          console.log("Creating new project:", { name: projectName, serverUrl })
          const [newProject] = await createProject.mutateAsync({
            name: projectName,
            description: projectDescription || null,
            path: projectPath,
            serverUrl,
            serverHostname: hostname,
            serverPort: parseInt(port),
            connectionStatus: "disconnected",
            isActive: false,
            isFavorite: false,
          })
          project = newProject
          console.log("Created project:", project.id)
        }

        // Set as active project
        console.log("Setting active project:", project.id)
        await setActiveProject.mutateAsync(project.id)

        // Update connection status to connecting
        console.log("Setting connection status to connecting")
        updateConnectionStatus.mutate({
          projectId: project.id,
          status: "connecting",
        })

        // Small delay to ensure settings are persisted
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Update the API client with new connection
        console.log("Updating API client base URL:", serverUrl)
        await apiClient.updateBaseUrl(hostname, parseInt(port))

        // Test the connection with retry logic
        console.log("Testing connection...")
        let lastError
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`Connection attempt ${attempt}/3`)
            await apiClient.ping()
            console.log("Connection successful!")
            updateConnectionStatus.mutate({
              projectId: project.id,
              status: "connected",
            })
            // Small delay to ensure mutation completes, then refetch
            await new Promise((resolve) => setTimeout(resolve, 100))
            await refetchAppInfo()
            onClose()
            return
          } catch (error) {
            console.log(`Connection attempt ${attempt} failed:`, error)
            lastError = error
            if (attempt < 3) {
              // Wait before retry (exponential backoff)
              await new Promise((resolve) => setTimeout(resolve, attempt * 500))
            }
          }
        }

        // If all retries failed
        throw lastError
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
        alert(`Failed to connect to server: ${error instanceof Error ? error.message : "Unknown error"}`)
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
                label="Server Hostname"
                value={hostname}
                onChangeText={setHostname}
                placeholder="127.0.0.1"
                leftAccessory={<Text>🖥️</Text>}
              />

              <BottomSheetInput
                label="Server Port"
                value={port}
                onChangeText={setPort}
                placeholder="4096"
                keyboardType="numeric"
                leftAccessory={<Text>🔌</Text>}
              />
            </Box>

            <Box gap="sm">
              {isConnected && isEditing ? (
                <Button mode="error" onPress={handleDisconnect}>
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
                >
                  <Button.Text size="md" weight="medium">
                    {isConnecting ? "Connecting..." : isEditing ? "Update & Connect" : "Create & Connect"}
                  </Button.Text>
                </Button>
              )}

              <Button variant="ghost" onPress={onClose}>
                <Button.Text size="md" weight="medium">
                  Cancel
                </Button.Text>
              </Button>
            </Box>

            <Box background="subtle" rounded="lg" p="md">
              <Text size="xs" mode="subtle">
                💡 Make sure your OpenCode server is running with:
              </Text>
              <Box mt="xs" background="dim" rounded="md" p="sm">
                <Text size="xs" weight="medium" mode="brand">
                  opencode serve --hostname 0.0.0.0 --port {port}
                </Text>
              </Box>
            </Box>
          </Box>
        </BottomSheetView>
      </BottomSheet>
    )
  },
)

ProjectConnectionSheet.displayName = "ProjectConnectionSheet"
