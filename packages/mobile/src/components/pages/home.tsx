import { useState, useRef } from "react"
import { FlatList, RefreshControl } from "react-native"
import { router } from "expo-router"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"
import { useLocalSessionsQuery } from "@/services/api/local/sessions"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"
import {
  ConnectionStatus,
  QuickActions,
  RecentSessionsHeader,
  SessionItem,
  ConnectionSheet,
} from "@/components/molecules/home"
import type { ConnectionSheetRef } from "@/components/molecules/home/connection-sheet"

export const HomePage = () => {
  const [refreshing, setRefreshing] = useState(false)
  const connectionSheetRef = useRef<ConnectionSheetRef>(null)
  const { data: sessions, isLoading, refetch: refetchSessions } = useLocalSessionsQuery()

  console.log("🏠 Home: sessions data", { sessions: sessions?.length, isLoading })
  const { refetch: refetchAppInfo } = useRemoteAppInfoQuery()

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([refetchSessions(), refetchAppInfo()])
    } finally {
      setRefreshing(false)
    }
  }

  const handleNewSession = () => {
    console.log("Create new session")
  }

  const handleSearch = (query: string) => {
    console.log("Search:", query)
  }

  const handleSessionPress = (sessionId: string) => {
    router.push(`/chat/${sessionId}`)
  }

  const handleViewAllSessions = () => {
    console.log("View all sessions")
  }

  const handleOpenConnectionSheet = () => {
    connectionSheetRef.current?.present()
  }

  const handleCloseConnectionSheet = () => {
    connectionSheetRef.current?.dismiss()
  }

  const renderHeader = () => (
    <Box p="md" gap="lg">
      {/* Header */}
      <Box gap="xs">
        <Text size="xxl" weight="bold" style={{ letterSpacing: -0.5 }}>
          OpenCode
        </Text>
        <Text size="md" mode="subtle" style={{ lineHeight: 20 }}>
          AI-powered development assistant
        </Text>
      </Box>

      {/* Connection Status */}
      <ConnectionStatus onOpenConnectionSheet={handleOpenConnectionSheet} />

      {/* Quick Actions */}
      <QuickActions onNewSession={handleNewSession} onSearch={handleSearch} />

      {/* Sessions Header */}
      <RecentSessionsHeader onViewAll={handleViewAllSessions} />
    </Box>
  )

  const renderEmptyState = () => (
    <Box center p="lg" m="md">
      <Box center p="lg" background="subtle" rounded="lg" border="subtle" gap="md">
        <Icon icon={Feather} name="message-square" size={48} color="muted" />
        <Box center gap="xs">
          <Text mode="subtle" size="md" weight="medium">
            No sessions yet
          </Text>
          <Text mode="subtle" size="sm" style={{ textAlign: "center", lineHeight: 18 }}>
            Create your first session to start chatting with AI
          </Text>
        </Box>
      </Box>
    </Box>
  )

  if (isLoading) {
    return (
      <Box flex safeAreaTop background="base">
        {renderHeader()}
        <Box center p="lg">
          <Box animation="pulse" animationConfig={{ repeat: 3 }}>
            <Text mode="subtle">Loading sessions...</Text>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box flex safeAreaTop background="base">
      <FlatList
        data={sessions || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Box pl="md" pr="md">
            <Box animation="slide-up" animationConfig={{ duration: 400, delay: index * 100 }}>
              <SessionItem session={item} onPress={handleSessionPress} />
            </Box>
          </Box>
        )}
        ItemSeparatorComponent={() => <Box style={{ height: 8 }} />}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        ListFooterComponent={() => <Box style={{ height: 150 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      />

      <ConnectionSheet ref={connectionSheetRef} onClose={handleCloseConnectionSheet} />
    </Box>
  )
}
