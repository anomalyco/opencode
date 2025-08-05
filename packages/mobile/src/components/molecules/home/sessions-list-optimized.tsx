import React, { useState, useCallback, useMemo, memo } from "react"
import { FlatList, RefreshControl } from "react-native"
import { router } from "expo-router"
import { Box } from "@/components/ui/primitives"
import { useInfiniteLocalSessionsQuery } from "@/services/api/local/sessions"
import { useRemoteAppInfoQuery } from "@/services/api/remote/config"
import { useFullSyncMutation } from "@/services/api/sync"
import { SessionItem } from "@/components/molecules/home"
import { SessionItemSkeleton } from "./session-item-skeleton"

interface SessionsListOptimizedProps {
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null
}

interface SessionData {
  id: string
  title: string
  timeUpdated: Date
  shareUrl?: string | null
  isSynced?: boolean | null
}

// Memoized render item to prevent unnecessary re-renders
const RenderSessionItem = memo<{ item: SessionData }>(({ item }) => {
  const handlePress = useCallback((sessionId: string) => {
    router.push(`/chat/${sessionId}`)
  }, [])

  return (
    <Box pl="md" pr="md">
      <SessionItem session={item} onPress={handlePress} />
    </Box>
  )
})

RenderSessionItem.displayName = "RenderSessionItem"

// Memoized separator component
const ItemSeparator = memo(() => <Box style={{ height: 8 }} />)
ItemSeparator.displayName = "ItemSeparator"

// Memoized footer component
const ListFooter = memo(() => <Box style={{ height: 150 }} />)
ListFooter.displayName = "ListFooter"

// Memoized empty state component
const EmptyState = memo(() => (
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
))

EmptyState.displayName = "EmptyState"

export const SessionsListOptimized = memo<SessionsListOptimizedProps>(({ ListHeaderComponent }) => {
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
    if (!data?.pages) return []

    // Deduplicate sessions by ID while preserving order
    const seen = new Set()
    return data.pages.flat().filter((session) => {
      if (seen.has(session.id)) return false
      seen.add(session.id)
      return true
    })
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

  const keyExtractor = useCallback((item: any) => item.id, [])

  const renderItem = useCallback(({ item }: { item: any }) => <RenderSessionItem item={item} />, [])

  const renderHeader = useCallback(() => {
    if (!ListHeaderComponent) return null
    if (typeof ListHeaderComponent === "function") {
      return <ListHeaderComponent />
    }
    return ListHeaderComponent
  }, [ListHeaderComponent])
  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: 80, // Approximate item height
      offset: 80 * index,
      index,
    }),
    [],
  )

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
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ItemSeparatorComponent={ItemSeparator}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={EmptyState}
      ListFooterComponent={ListFooter}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
      // Performance optimizations
      removeClippedSubviews={true}
      maxToRenderPerBatch={8}
      windowSize={10}
      initialNumToRender={6}
      updateCellsBatchingPeriod={50}
      getItemLayout={getItemLayout}
      // Pagination
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      // Memory optimizations
      disableVirtualization={false}
      legacyImplementation={false}
    />
  )
})

SessionsListOptimized.displayName = "SessionsListOptimized"
