import React, { useState, useCallback, memo } from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import { useActiveProjectQuery, useUpdateProjectConnectionStatusMutation } from "@/services/api/local/projects"
import { useRemoteSessionsQuery } from "@/services/api/remote/sessions"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/services/api/keys"
import { apiClient } from "@/services/api/remote/client"
import { Feather } from "@expo/vector-icons"

interface ConnectionStatusOptimizedProps {
  onOpenConnectionSheet: () => void
}

export const ConnectionStatusOptimized = memo<ConnectionStatusOptimizedProps>(({ onOpenConnectionSheet }) => {
  const { data: activeProject } = useActiveProjectQuery()
  const [isConnecting, setIsConnecting] = useState(false)
  const updateConnectionStatus = useUpdateProjectConnectionStatusMutation()
  const { refetch: refetchRemoteSessions } = useRemoteSessionsQuery()
  const queryClient = useQueryClient()

  const handleConnectionToggle = useCallback(async () => {
    if (!activeProject) return

    const isCurrentlyConnected = activeProject.connectionStatus === "connected"

    if (isCurrentlyConnected) {
      // Disconnect
      await updateConnectionStatus.mutateAsync({
        projectId: activeProject.id,
        status: "disconnected",
      })
    } else {
      // Connect
      setIsConnecting(true)
      try {
        // Set status to connecting
        await updateConnectionStatus.mutateAsync({
          projectId: activeProject.id,
          status: "connecting",
        })

        // Update API client base URL and test connection
        await apiClient.updateBaseUrlFromString(activeProject.serverUrl)
        await apiClient.ping()

        // Set status to connected on success
        await updateConnectionStatus.mutateAsync({
          projectId: activeProject.id,
          status: "connected",
        })

        // Fetch remote sessions and invalidate local queries
        await refetchRemoteSessions()
        queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
      } catch (error) {
        // Set status to disconnected on failure
        await updateConnectionStatus.mutateAsync({
          projectId: activeProject.id,
          status: "disconnected",
        })
      } finally {
        setIsConnecting(false)
      }
    }
  }, [activeProject, updateConnectionStatus, refetchRemoteSessions, queryClient])

  // Don't render if no active project
  if (!activeProject) {
    return (
      <Box background="subtle" rounded="lg" p="md" border="subtle">
        <Box direction="row" justifyContent="space-between" alignItems="center">
          <Box flex direction="row" alignItems="center" gap="sm">
            <Icon icon={Feather} name="server" size={16} color="muted" />
            <Text size="sm" weight="medium">
              Add Your First Server
            </Text>
          </Box>
          <Button size="sm" mode="brand" onPress={onOpenConnectionSheet}>
            <Button.Icon>
              {({ color, size }) => <Icon icon={Feather} name="plus" size={size} color={color} />}
            </Button.Icon>
            <Button.Text size="xs" weight="medium">
              Add Server
            </Button.Text>
          </Button>
        </Box>
      </Box>
    )
  }

  const connectionStatus = activeProject.connectionStatus || "disconnected"
  const isConnected = connectionStatus === "connected"
  const isConnectingState = isConnecting || connectionStatus === "connecting"

  const getButtonText = () => {
    if (isConnectingState) return "Connecting..."
    if (isConnected) return "Connected"
    return "Connect"
  }

  const getButtonMode = () => {
    if (isConnectingState) return "warning"
    if (isConnected) return "success"
    return "brand"
  }

  const getStatusIcon = () => {
    if (isConnectingState) return "loader"
    if (isConnected) return "wifi"
    return "wifi-off"
  }

  const getStatusColor = () => {
    if (isConnectingState) return "warning"
    if (isConnected) return "success"
    return "error"
  }

  return (
    <Box background="subtle" rounded="lg" p="md" border="subtle">
      <Box direction="row" justifyContent="space-between" alignItems="center">
        <Box flex direction="row" alignItems="center" gap="sm">
          <Icon icon={Feather} name={getStatusIcon()} size={16} color={getStatusColor()} />
          <Box flex>
            <Text size="sm" weight="medium">
              {activeProject.name}
            </Text>
            <Text size="xs" mode="subtle">
              {activeProject.serverUrl}
            </Text>
          </Box>
        </Box>

        <Button
          size="sm"
          mode={getButtonMode()}
          onPress={isConnected ? onOpenConnectionSheet : handleConnectionToggle}
          loading={isConnectingState}
        >
          <Button.Icon>
            {({ color, size }) => (
              <Icon icon={Feather} name={isConnected ? "settings" : "play"} size={size} color={color} />
            )}
          </Button.Icon>
          <Button.Text size="xs" weight="medium">
            {getButtonText()}
          </Button.Text>
        </Button>
      </Box>
    </Box>
  )
})

ConnectionStatusOptimized.displayName = "ConnectionStatusOptimized"
