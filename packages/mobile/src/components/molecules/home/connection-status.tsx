import { Box, Text, Button } from "@/components/ui/primitives"
import { useLocalAppConfigQuery } from "@/services/api/local/config"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"

interface ConnectionStatusProps {
  onOpenConnectionSheet: () => void
}

export const ConnectionStatus = ({ onOpenConnectionSheet }: ConnectionStatusProps) => {
  const { data: appConfig } = useLocalAppConfigQuery()
  const { data: appInfo, error } = useRemoteAppInfoQuery()

  const getButtonText = () => {
    if (appConfig?.connectionStatus === "connecting") return "Connecting..."
    if (error || !appInfo || appConfig?.connectionStatus === "disconnected") return "Connect"
    return "Disconnect"
  }

  const getButtonMode = () => {
    if (appConfig?.connectionStatus === "connecting") return "warning"
    if (error || !appInfo || appConfig?.connectionStatus === "disconnected") return "brand"
    return "success"
  }

  const isConnected = appConfig?.connectionStatus === "connected" && appInfo
  const isConnecting = appConfig?.connectionStatus === "connecting"

  return (
    <Box background="subtle" rounded="lg" p="md" border="subtle">
      <Box direction="row" justifyContent="space-between" alignItems="center">
        <Box flex>
          <Text size="sm" weight="medium">
            Server Status
          </Text>
          <Text size="xs" mode="subtle">
            {appConfig?.serverHostname}:{appConfig?.serverPort}
          </Text>
        </Box>

        <Button size="auto" mode={getButtonMode()} onPress={onOpenConnectionSheet} loading={isConnecting}>
          <Box pl="sm" pr="sm" pt="xs" pb="xs">
            <Text size="xs" weight="medium" inverse={!isConnected}>
              {getButtonText()}
            </Text>
          </Box>
        </Button>
      </Box>
    </Box>
  )
}
