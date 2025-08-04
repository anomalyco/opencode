import { useState, forwardRef, useImperativeHandle, useRef } from "react"
import { Box, Text, Button, BottomSheet } from "@/components/ui/primitives"
import type { BottomSheetRef } from "@/components/ui/primitives"
import { BottomSheetView } from "@gorhom/bottom-sheet"
import { BottomSheetInput } from "./bottom-sheet-input"
import {
  useLocalAppConfigQuery,
  useSetServerConnectionMutation,
  useSetServerConnectionStringMutation,
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
  const setServerConnectionString = useSetServerConnectionStringMutation()
  const updateConnectionStatus = useUpdateConnectionStatusMutation()
  const { refetch: refetchAppInfo } = useRemoteAppInfoQuery()

  const bottomSheetRef = useRef<BottomSheetRef>(null)

  const [useConnectionString, setUseConnectionString] = useState(!!appConfig?.connectionString)
  const [hostname, setHostname] = useState(appConfig?.serverHostname || "127.0.0.1")
  const [port, setPort] = useState(appConfig?.serverPort?.toString() || "4096")
  const [connectionString, setConnectionString] = useState(appConfig?.connectionString || "")
  const [isConnecting, setIsConnecting] = useState(false)

  useImperativeHandle(ref, () => ({
    present: () => bottomSheetRef.current?.present(),
    dismiss: () => bottomSheetRef.current?.dismiss(),
  }))

  const handleConnect = async () => {
    setIsConnecting(true)
    updateConnectionStatus.mutate("connecting")

    try {
      let finalHostname = hostname
      let finalPort = parseInt(port)

      // Save connection settings first to ensure they're available
      if (useConnectionString) {
        await new Promise<void>((resolve) => {
          setServerConnectionString.mutate(connectionString, { onSuccess: () => resolve() })
        })

        // Parse connection string to get hostname and port for API client
        try {
          const url = new URL(connectionString.startsWith("http") ? connectionString : `http://${connectionString}`)
          finalHostname = url.hostname
          finalPort = url.port ? parseInt(url.port) : url.protocol === "https:" ? 443 : 80
        } catch (error) {
          // If parsing fails, treat as hostname:port format
          const parts = connectionString.split(":")
          if (parts.length === 2) {
            finalHostname = parts[0]
            const parsedPort = parseInt(parts[1])
            if (!isNaN(parsedPort)) {
              finalPort = parsedPort
            }
          } else if (parts.length === 1) {
            finalHostname = parts[0]
          }
        }
      } else {
        await new Promise<void>((resolve) => {
          setServerConnection.mutate({ hostname, port: finalPort }, { onSuccess: () => resolve() })
        })
      }

      // Small delay to ensure settings are persisted
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Update the API client with new connection
      if (useConnectionString) {
        await apiClient.updateBaseUrlFromString(connectionString)
      } else {
        await apiClient.updateBaseUrl(finalHostname, finalPort)
      }

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
    <BottomSheet
      ref={bottomSheetRef}
      snapPoints={["60%"]}
      onDismiss={onClose}
      enablePanDownToClose
      keyboardBehavior="fillParent"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetView style={{ flex: 1 }}>
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
                Connection Mode
              </Text>
              <Box direction="row" gap="sm">
                <Button
                  variant={!useConnectionString ? "outline" : "ghost"}
                  onPress={() => setUseConnectionString(false)}
                >
                  <Button.Text size="sm" weight="medium">
                    Host + Port
                  </Button.Text>
                </Button>
                <Button
                  variant={useConnectionString ? "outline" : "ghost"}
                  onPress={() => setUseConnectionString(true)}
                >
                  <Button.Text size="sm" weight="medium">
                    URL String
                  </Button.Text>
                </Button>
              </Box>
            </Box>
            {useConnectionString ? (
              <BottomSheetInput
                label="Connection URL"
                value={connectionString}
                onChangeText={setConnectionString}
                placeholder="http://127.0.0.1:4096 or myserver.tailscale.net"
                leftAccessory={<Text>🔗</Text>}
              />
            ) : (
              <>
                <BottomSheetInput
                  label="Hostname"
                  value={hostname}
                  onChangeText={setHostname}
                  placeholder="127.0.0.1"
                  leftAccessory={<Text>🖥️</Text>}
                />

                <BottomSheetInput
                  label="Port"
                  value={port}
                  onChangeText={setPort}
                  placeholder="4096"
                  keyboardType="numeric"
                  leftAccessory={<Text>🔌</Text>}
                />
              </>
            )}
          </Box>
          <Box gap="sm">
            {isConnected ? (
              <Button mode="error" onPress={handleDisconnect}>
                <Button.Text size="md" weight="medium">
                  Disconnect
                </Button.Text>
              </Button>
            ) : (
              <Button mode="brand" onPress={handleConnect} loading={isConnecting}>
                <Button.Text size="md" weight="medium">
                  {isConnecting ? "Connecting..." : "Connect"}
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
                opencode serve --hostname 0.0.0.0 --port 4096
              </Text>
            </Box>
            <Box mt="xs">
              <Text size="xs" mode="subtle">
                Use "URL String" mode for Tailscale or custom URLs without ports.
              </Text>
            </Box>
          </Box>
        </Box>
      </BottomSheetView>
    </BottomSheet>
  )
})

ConnectionSheet.displayName = "ConnectionSheet"
