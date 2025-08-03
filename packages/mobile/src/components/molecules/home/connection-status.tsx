import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import { useLocalAppConfigQuery } from "@/services/api/local/config"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"
import { Feather } from "@expo/vector-icons"

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
        <Box flex direction="row" alignItems="center" gap="sm">
          <Icon
            icon={Feather}
            name={isConnected ? "wifi" : "wifi-off"}
            size={16}
            color={isConnected ? "success" : "error"}
          />
          <Box flex>
            <Text size="sm" weight="medium">
              Server Status
            </Text>
            <Text size="xs" mode="subtle">
              {appConfig?.serverHostname}:{appConfig?.serverPort}
            </Text>
          </Box>
        </Box>

        <Button size="sm" mode={getButtonMode()} onPress={onOpenConnectionSheet} loading={isConnecting}>
          <Button.Icon>
            <Icon icon={Feather} name={isConnected ? "check-circle" : "settings"} size={14} />
          </Button.Icon>
          <Button.Text size="xs" weight="medium">
            {getButtonText()}
          </Button.Text>
        </Button>
      </Box>
    </Box>
  )
}
