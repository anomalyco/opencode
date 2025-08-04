import { useState, forwardRef, useImperativeHandle, useRef } from "react"
import { Box, Text, Button, Input, BottomSheet } from "@/components/ui/primitives"
import type { BottomSheetRef } from "@/components/ui/primitives"
import {
  useLocalAppConfigQuery,
  useSetServerConnectionMutation,
  useUpdateConnectionStatusMutation,
} from "@/services/api/local/config"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"
import { apiClient } from "@/services/api/remote/client"

interface ConnectionSheetProps {
  onClose: () => void
}

export interface ConnectionSheetRef {
  present: () => void
  dismiss: () => void
}

export const ConnectionSheet = forwardRef<ConnectionSheetRef, ConnectionSheetProps>(({ onClose }, ref) => {
  const { data: appConfig } = useLocalAppConfigQuery()
  const setServerConnection = useSetServerConnectionMutation()
  const updateConnectionStatus = useUpdateConnectionStatusMutation()
  const { refetch: refetchAppInfo } = useRemoteAppInfoQuery()

  const bottomSheetRef = useRef<BottomSheetRef>(null)

  const [hostname, setHostname] = useState(appConfig?.serverHostname || "127.0.0.1")
  const [port, setPort] = useState(appConfig?.serverPort?.toString() || "4096")
  const [isConnecting, setIsConnecting] = useState(false)

  useImperativeHandle(ref, () => ({
    present: () => bottomSheetRef.current?.present(),
    dismiss: () => bottomSheetRef.current?.dismiss(),
  }))

  const handleConnect = async () => {
    setIsConnecting(true)
    updateConnectionStatus.mutate("connecting")

    try {
      const portNum = parseInt(port)

      // Save connection settings first to ensure they're available
      await new Promise<void>((resolve) => {
        setServerConnection.mutate({ hostname, port: portNum }, { onSuccess: () => resolve() })
      })

      // Small delay to ensure settings are persisted
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Update the API client with new connection
      await apiClient.updateBaseUrl(hostname, portNum)

      // Test the connection with retry logic
      let lastError
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await apiClient.ping()
          updateConnectionStatus.mutate("connected")
          // Small delay to ensure mutation completes, then refetch
          await new Promise((resolve) => setTimeout(resolve, 100))
          await refetchAppInfo()
          onClose()
          return
        } catch (error) {
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
      updateConnectionStatus.mutate("disconnected")
    } finally {
      setIsConnecting(false)
    }
  }
  const handleDisconnect = async () => {
    updateConnectionStatus.mutate("disconnected")
    // Small delay to ensure mutation completes, then refetch
    await new Promise((resolve) => setTimeout(resolve, 100))
    await refetchAppInfo()
    onClose()
  }

  const isConnected = appConfig?.connectionStatus === "connected"

  return (
    <BottomSheet ref={bottomSheetRef} snapPoints={["60%"]} onDismiss={onClose} enablePanDownToClose>
      <Box p="md" gap="lg">
        <Box>
          <Text size="lg" weight="semibold">
            Server Connection
          </Text>
          <Text size="sm" mode="subtle">
            Configure your OpenCode server connection
          </Text>
        </Box>

        <Box gap="md">
          <Box gap="xs">
            <Text size="sm" weight="medium">
              Hostname
            </Text>
            <Input
              value={hostname}
              onChangeText={setHostname}
              placeholder="127.0.0.1"
              leftAccessory={
                <Input.Accessory>
                  <Text>🖥️</Text>
                </Input.Accessory>
              }
            />
          </Box>

          <Box gap="xs">
            <Text size="sm" weight="medium">
              Port
            </Text>
            <Input
              value={port}
              onChangeText={setPort}
              placeholder="4096"
              keyboardType="numeric"
              leftAccessory={
                <Input.Accessory>
                  <Text>🔌</Text>
                </Input.Accessory>
              }
            />
          </Box>
        </Box>

        <Box gap="sm">
          {isConnected ? (
            <Button size="auto" mode="error" onPress={handleDisconnect}>
              <Box p="sm" center>
                <Text size="md" weight="medium" inverse>
                  Disconnect
                </Text>
              </Box>
            </Button>
          ) : (
            <Button size="auto" mode="brand" onPress={handleConnect} loading={isConnecting}>
              <Box p="sm" center>
                <Text size="md" weight="medium" inverse>
                  {isConnecting ? "Connecting..." : "Connect"}
                </Text>
              </Box>
            </Button>
          )}

          <Button size="auto" variant="ghost" onPress={onClose}>
            <Box p="sm" center>
              <Text size="md" weight="medium">
                Cancel
              </Text>
            </Box>
          </Button>
        </Box>

        <Box background="subtle" rounded="lg" p="md">
          <Text size="xs" mode="subtle">
            💡 Make sure your OpenCode server is running with:
          </Text>
          <Box mt="xs" background="dim" rounded="md" p="sm">
            <Text size="xs" weight="medium" mode="brand">
              opencode serve --hostname 0.0.0.0 --port 4096
            </Text>
          </Box>
        </Box>
      </Box>
    </BottomSheet>
  )
})

ConnectionSheet.displayName = "ConnectionSheet"
