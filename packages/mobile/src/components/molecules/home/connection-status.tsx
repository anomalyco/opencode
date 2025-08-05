import { useState, useCallback } from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import {
  useActiveProjectQuery,
  useProjectsQuery,
  useUpdateProjectConnectionStatusMutation,
} from "@/services/api/local/projects"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"
import { useRemoteSessionsQuery } from "@/services/api/remote/sessions"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/services/api/keys"
import { ConnectionService } from "@/services/connection-service"
import { Feather } from "@expo/vector-icons"

interface ConnectionStatusProps {
  onOpenConnectionSheet: () => void
}

export const ConnectionStatus = ({ onOpenConnectionSheet }: ConnectionStatusProps) => {
  const { data: activeProject } = useActiveProjectQuery()
  const { data: projects } = useProjectsQuery()
  const { data: appInfo } = useRemoteAppInfoQuery()
  const { refetch: refetchRemoteSessions } = useRemoteSessionsQuery()
  const queryClient = useQueryClient()
  const [isConnecting, setIsConnecting] = useState(false)
  const updateConnectionStatus = useUpdateProjectConnectionStatusMutation()

  const handleConnectionSuccess = useCallback(async () => {
    // Fetch remote sessions to sync with server
    await refetchRemoteSessions()

    // Invalidate local session queries to refresh home screen
    queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
  }, [refetchRemoteSessions, queryClient])

  const handleConnectionToggle = useCallback(async () => {
    if (!activeProject) return

    const isCurrentlyConnected = activeProject.connectionStatus === "connected"

    if (isCurrentlyConnected) {
      // Disconnect
      await ConnectionService.disconnectProject(activeProject.id, {
        updateConnectionStatus: updateConnectionStatus.mutateAsync,
      })
    } else {
      // Connect
      setIsConnecting(true)
      try {
        await ConnectionService.connectToProject(
          activeProject.id,
          activeProject.serverUrl,
          {
            updateConnectionStatus: updateConnectionStatus.mutateAsync,
          },
          {
            onConnectionSuccess: handleConnectionSuccess,
          },
        )
      } finally {
        setIsConnecting(false)
      }
    }
  }, [activeProject, updateConnectionStatus, handleConnectionSuccess])

  // CONDITIONAL RENDERING LOGIC - AFTER ALL HOOKS

  // If no projects exist, show "Add Server" state
  if (!projects || projects.length === 0) {
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

  // If no active project, show message
  if (!activeProject) {
    return (
      <Box background="subtle" rounded="lg" p="md" border="subtle">
        <Box direction="row" justifyContent="space-between" alignItems="center">
          <Box flex direction="row" alignItems="center" gap="sm">
            <Icon icon={Feather} name="alert-circle" size={16} color="warning" />
            <Text size="sm" weight="medium">
              No Active Project
            </Text>
          </Box>

          <Button size="sm" mode="brand" onPress={onOpenConnectionSheet}>
            <Button.Icon>
              {({ color, size }) => <Icon icon={Feather} name="settings" size={size} color={color} />}
            </Button.Icon>
            <Button.Text size="xs" weight="medium">
              Select Project
            </Button.Text>
          </Button>
        </Box>
      </Box>
    )
  }

  // Normal project display when active project exists
  const connectionStatus = activeProject.connectionStatus || "disconnected"
  const isConnected = connectionStatus === "connected" && appInfo
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
}
