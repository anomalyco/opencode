import { useState, useCallback, useMemo } from "react"
import { FlatList, RefreshControl } from "react-native"
import { router } from "expo-router"
import { Box } from "@/components/ui/primitives"
import { useInfiniteLocalSessionsQuery } from "@/services/api/local/sessions"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"
import { useFullSyncMutation } from "@/services/api/sync"
import { SessionItem } from "@/components/molecules/home"
import { SessionItemSkeleton } from "./session-item-skeleton"

interface SessionsListProps {
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null
}

export const SessionsList = ({ ListHeaderComponent }: SessionsListProps) => {
  const [refreshing, setRefreshing] = useState(false)

  const {
    data,
    isLoading,
    refetch: refetchSessions,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteLocalSessionsQuery(20)

  const { refetch: refetchAppInfo } = useRemoteAppInfoQuery()
  const fullSyncMutation = useFullSyncMutation()

  const sessions = useMemo(() => {
    return data?.pages?.flat() ?? []
  }, [data])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([refetchSessions(), refetchAppInfo(), fullSyncMutation.mutateAsync()])
    } catch (error) {
      // Handle error silently
    } finally {
      setRefreshing(false)
    }
  }, [refetchSessions, refetchAppInfo, fullSyncMutation])

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleSessionPress = useCallback((sessionId: string) => {
    router.push(`/chat/${sessionId}`)
  }, [])

  const renderEmptyState = useCallback(
    () => (
      <Box center p="lg" m="md">
        <Box center p="lg" background="subtle" rounded="lg" border="subtle" gap="md">
          <Box center gap="xs">
            <Box animation="pulse" animationConfig={{ repeat: -1 }}>
              <Box style={{ width: 48, height: 48, opacity: 0.5 }} />
            </Box>
            <Box gap="xs">
              <Box background="subtle" rounded="md" style={{ width: 200, height: 16 }} />
              <Box background="subtle" rounded="md" style={{ width: 240, height: 12 }} />
            </Box>
          </Box>
        </Box>
      </Box>
    ),
    [],
  )

  const renderHeader = () => {
    if (!ListHeaderComponent) return null
    if (typeof ListHeaderComponent === "function") {
      return <ListHeaderComponent />
    }
    return ListHeaderComponent
  }

  if (isLoading) {
    return (
      <Box flex>
        {renderHeader()}
        <Box p="md" gap="md">
          {[1, 2, 3, 4].map((i) => (
            <SessionItemSkeleton key={i} />
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <FlatList
      data={sessions}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Box pl="md" pr="md">
          <SessionItem session={item} onPress={handleSessionPress} />
        </Box>
      )}
      ItemSeparatorComponent={() => <Box style={{ height: 8 }} />}
      ListHeaderComponent={ListHeaderComponent as any}
      ListEmptyComponent={renderEmptyState}
      ListFooterComponent={() => <Box style={{ height: 150 }} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      windowSize={10}
      initialNumToRender={8}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
    />
  )
}
