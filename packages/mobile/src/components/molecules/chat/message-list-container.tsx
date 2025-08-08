import { memo, useRef, useCallback, forwardRef, useImperativeHandle } from "react"
import { FlatList, Keyboard, RefreshControl } from "react-native"
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native"
import { Box, Text, Icon, Button } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"
import { MessagePartRenderer } from "./message-part-renderer"

interface MessageListContainerProps {
  items: any[]
  refreshing: boolean
  onRefresh: () => void
  onRetry: () => void
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null
}

export interface MessageListContainerRef {
  scrollToBottom: () => void
}

const MemoizedFlatList = memo(FlatList<any>)

const ItemRenderer = memo(
  ({ item }: { item: any }) => {
    if (item.type === "part") {
      return <MessagePartRenderer part={item} />
    }
    return null
  },
  (prevProps, nextProps) => {
    if (prevProps.item === nextProps.item) return true

    return (
      prevProps.item.id === nextProps.item.id &&
      prevProps.item.type === nextProps.item.type &&
      prevProps.item.data === nextProps.item.data
    )
  },
)

ItemRenderer.displayName = "ItemRenderer"

export const MessageListContainer = memo(
  forwardRef<MessageListContainerRef, MessageListContainerProps>(
    ({ items, refreshing, onRefresh, onRetry, ListHeaderComponent }, ref) => {
      const flatListRef = useRef<FlatList>(null)
      const lastScrollY = useRef(0)
      const isUserScrolling = useRef(false)

      const scrollToBottom = useCallback(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
      }, [])

      useImperativeHandle(ref, () => ({
        scrollToBottom,
      }))

      const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const currentY = event.nativeEvent.contentOffset.y
        const deltaY = currentY - lastScrollY.current

        if (deltaY > 8 && currentY > -30 && isUserScrolling.current) {
          Keyboard.dismiss()
        }

        lastScrollY.current = currentY
      }, [])

      const handleScrollBeginDrag = useCallback(() => {
        isUserScrolling.current = true
      }, [])

      const handleScrollEndDrag = useCallback(() => {
        isUserScrolling.current = false
      }, [])

      const renderEmptyState = useCallback(
        () => (
          <Box center p="lg" m="md" style={{ transform: [{ scaleY: -1 }], marginBottom: 60 }}>
            <Box center p="lg" background="subtle" rounded="lg" border="subtle" gap="md">
              <Icon icon={Feather} name="message-square" size={48} color="muted" />
              <Box center gap="xs">
                <Text mode="subtle" size="md" weight="medium">
                  No messages yet
                </Text>
                <Text mode="subtle" size="sm" style={{ textAlign: "center", lineHeight: 18 }}>
                  Start the conversation with OpenCode
                </Text>
              </Box>
              <Button variant="ghost" size="sm" onPress={onRetry} style={{ marginTop: 8 }}>
                <Icon icon={Feather} name="refresh-cw" size={16} color="muted" />
                <Text mode="subtle" size="sm" weight="medium">
                  Retry
                </Text>
              </Button>
            </Box>
          </Box>
        ),
        [onRetry],
      )

      const keyExtractor = useCallback((item: any) => {
        return `${item.type}-${item.id}`
      }, [])

      const renderItem = useCallback(({ item }: { item: any }) => {
        return <ItemRenderer item={item} />
      }, [])

      return (
        <MemoizedFlatList
          ref={flatListRef}
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          inverted
          ListEmptyComponent={renderEmptyState}
          ListHeaderComponent={ListHeaderComponent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={10} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: 140,
            paddingBottom: 120,
          }}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          scrollEventThrottle={32}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 5,
          }}
          removeClippedSubviews={true}
          maxToRenderPerBatch={3}
          windowSize={5}
          initialNumToRender={5}
          updateCellsBatchingPeriod={200}
          disableVirtualization={false}
          legacyImplementation={false}
        />
      )
    },
  ),
)

MessageListContainer.displayName = "MessageListContainer"
