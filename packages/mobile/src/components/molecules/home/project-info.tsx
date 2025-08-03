import { Box, Text } from "@/components/ui/primitives"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"

export const ProjectInfo = () => {
  const { data: appInfo } = useRemoteAppInfoQuery()

  if (!appInfo) return null

  return (
    <Box background="subtle" rounded="lg" p="md" border="subtle">
      <Box mb="xs">
        <Text size="sm" weight="medium">
          Current Project
        </Text>
      </Box>
      <Text size="xs" mode="subtle" numberOfLines={2}>
        {appInfo.cwd}
      </Text>
      <Box direction="row" justifyContent="space-between" mt="sm">
        <Text size="xs" mode="subtle">
          Platform: {appInfo.platform}
        </Text>
        <Text size="xs" mode="subtle">
          v{appInfo.version}
        </Text>
      </Box>
    </Box>
  )
}
