import { useState, useRef, forwardRef, useImperativeHandle } from "react"
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetView } from "@gorhom/bottom-sheet"
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet"
import { Box, Text, Button, Input } from "@/components/ui/primitives"
import {
  useLocalAppConfigQuery,
  useSetServerConnectionMutation,
  useUpdateConnectionStatusMutation,
} from "@/services/api/local/config"
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

  const bottomSheetModalRef = useRef<BottomSheetModal>(null)

  const [hostname, setHostname] = useState(appConfig?.serverHostname || "127.0.0.1")
  const [port, setPort] = useState(appConfig?.serverPort?.toString() || "4096")
  const [isConnecting, setIsConnecting] = useState(false)

  useImperativeHandle(ref, () => ({
    present: () => bottomSheetModalRef.current?.present(),
    dismiss: () => bottomSheetModalRef.current?.dismiss(),
  }))
  const handleConnect = async () => {
    setIsConnecting(true)
    updateConnectionStatus.mutate("connecting")

    try {
      // Update the API client with new connection
      await apiClient.updateBaseUrl(hostname, parseInt(port))

      // Test the connection
      await apiClient.ping()

      // Save connection settings
      setServerConnection.mutate({
        hostname,
        port: parseInt(port),
      })

      updateConnectionStatus.mutate("connected")
      onClose()
    } catch (error) {
      console.error("Connection failed:", error)
      updateConnectionStatus.mutate("disconnected")
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = () => {
    updateConnectionStatus.mutate("disconnected")
    onClose()
  }

  const isConnected = appConfig?.connectionStatus === "connected"

  const renderBackdrop = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
  )

  return (
    <BottomSheetModal
      ref={bottomSheetModalRef}
      snapPoints={["60%"]}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
    >
      <BottomSheetView>
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
      </BottomSheetView>
    </BottomSheetModal>
  )
})
