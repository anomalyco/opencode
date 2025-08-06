/**
 * Streaming Message List - Handles streaming state internally
 * Prevents parent component re-renders during streaming
 */

import { memo, useRef, useCallback, forwardRef, useImperativeHandle, useMemo, useState } from "react"
import { FlatList, Keyboard, RefreshControl, TouchableOpacity } from "react-native"
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native"
import { Box, Text, Icon, Button } from "@/components/ui/primitives"
import { TypingIndicator } from "@/components/molecules/chat"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import {
  ToolStatusIndicator,
  FileContentRenderer,
  BashRenderer,
  TodoListRenderer,
  DiffRenderer,
  WebFetchRenderer,
} from "./message-renderers"
import { useLocalSessionPartsQuery } from "@/services/api/local/messages"

import { Feather } from "@expo/vector-icons"
import { useChatState } from "@/hooks/use-chat-state"

interface StreamingMessageListProps {
  sessionId: string
  keyboardHeight: number
  onRefresh: () => Promise<void>
  refreshing: boolean
}

export interface StreamingMessageListRef {
  scrollToBottom: () => void
}

// Memoized FlatList for performance
const MemoizedFlatList = memo(FlatList<any>)

// Component to render individual message parts
const PartItem = memo(({ part }: { part: any }) => {
  const isUser = part.role === "user"
  const partData = part.data

  // Calculate all values with useMemo to avoid conditional hook calls
  const partType = useMemo(() => {
    return partData.type || (partData.toolName ? "tool" : partData.fileFilename ? "file" : "text")
  }, [partData])

  const isShortMessage = useMemo(() => {
    return (
      partType === "text" &&
      partData.textContent &&
      partData.textContent.length < 100 &&
      partData.textContent.split("\n").length <= 2
    )
  }, [partType, partData])

  // Check if this is a very short text message that should have minimal width
  const isVeryShortMessage = useMemo(() => {
    return (
      partType === "text" &&
      partData.textContent &&
      partData.textContent.length < 20 &&
      partData.textContent.split("\n").length === 1
    )
  }, [partType, partData])

  // Check if this is a todo/plan message that needs more width
  const isTodoMessage = useMemo(() => {
    return partData.toolName === "todowrite" || partData.toolName === "todoread"
  }, [partData])

  const shouldRender = useMemo(() => {
    if (partType === "text") {
      return !partData.isSynthetic && partData.textContent && !partData.textContent.includes("<system-reminder>")
    }
    // Skip step parts - they cause UI clutter and sequence issues
    if (partType === "step-start" || partType === "step-finish") {
      return false
    }
    return true
  }, [partType, partData])

  const content = useMemo(() => {
    if (!shouldRender) return null

    switch (partType) {
      case "text":
        return <ThemedMarked value={partData.textContent} />

      case "tool":
        return <ToolPartRenderer part={partData} />

      case "file":
        return <FilePartRenderer part={partData} />

      case "snapshot":
        return <SnapshotRenderer part={partData} />

      case "patch":
        return <PatchRenderer part={partData} />

      default:
        return null
    }
  }, [shouldRender, partType, partData])

  // Early return if shouldn't render
  if (!shouldRender || !content) {
    return null
  }

  return (
    <Box p="sm">
      <Box direction="row" justifyContent={isUser ? "flex-end" : "flex-start"}>
        <Box
          background={isUser ? "emphasis" : "lightest"}
          rounded="lg"
          p={partType === "tool" ? undefined : isShortMessage ? "sm" : "md"}
          style={{
            maxWidth: "85%",
            minWidth: isTodoMessage ? "70%" : isVeryShortMessage ? "auto" : partType === "text" ? "40%" : "20%",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
          }}
        >
          {content}
        </Box>
      </Box>
    </Box>
  )
})

// Separate components for different part types to avoid conditional rendering
const ToolPartRenderer = memo(({ part }: { part: any }) => {
  // Extract tool data from the complete part data structure
  const toolName = part.toolName || part.tool
  const toolStatus = part.toolStatus || part.state?.status || "pending"
  const toolCallId = part.toolCallId || part.callID
  const toolInput = part.toolInput
    ? typeof part.toolInput === "string"
      ? JSON.parse(part.toolInput)
      : part.toolInput
    : part.state?.input
  const toolOutput = part.toolOutput || part.state?.output
  const toolMetadata = part.toolMetadata
    ? typeof part.toolMetadata === "string"
      ? JSON.parse(part.toolMetadata)
      : part.toolMetadata
    : part.state?.metadata
  const toolError = part.toolError || part.state?.error
  const toolTitle = part.toolTitle || part.state?.title

  // Extract timing information
  const toolTimeStart = part.toolTimeStart || (part.state?.time?.start ? new Date(part.state.time.start) : null)
  const toolTimeEnd = part.toolTimeEnd || (part.state?.time?.end ? new Date(part.state.time.end) : null)

  // Calculate execution time if available
  const executionTime = toolTimeStart && toolTimeEnd ? toolTimeEnd.getTime() - toolTimeStart.getTime() : null

  // Show enhanced status indicator for pending/running tools
  if (toolStatus === "pending" || toolStatus === "running") {
    const displayName = toolTitle || toolName || "Working..."
    const statusText =
      toolStatus === "running" && executionTime ? `${displayName} (${Math.round(executionTime / 1000)}s)` : displayName
    return <ToolStatusIndicator status={toolStatus} toolName={statusText} />
  }

  // Show basic tool info even if incomplete
  if (!toolName && !toolOutput && !toolError) {
    return (
      <Box background="subtle" rounded="md" p="sm">
        <Text size="xs" weight="medium" mode="subtle">
          Tool call in progress...
        </Text>
      </Box>
    )
  }

  // Show enhanced error state
  if (toolStatus === "error" && toolError) {
    const displayName = toolTitle || toolName || "Tool"
    const errorHeader = `**Error in ${displayName}:**`
    const errorDetails = toolCallId ? `\n\n*Call ID: ${toolCallId}*` : ""
    const timingInfo = executionTime ? `\n*Duration: ${Math.round(executionTime / 1000)}s*` : ""

    return (
      <Box background="lighter" rounded="md" p="sm" mode="error">
        <ThemedMarked value={`${errorHeader} ${toolError}${errorDetails}${timingInfo}`} />
      </Box>
    )
  }

  // Render completed tools based on type
  switch (toolName) {
    case "read":
      if (toolMetadata?.preview && toolInput?.filePath) {
        return <FileContentRenderer filename={toolInput.filePath} content={toolMetadata.preview} truncateLines={6} />
      }
      break

    case "edit":
      if (toolMetadata?.diff && toolInput?.filePath) {
        return <DiffRenderer filename={toolInput.filePath} diff={toolMetadata.diff} />
      }
      break

    case "write":
      if (toolInput?.filePath && toolInput?.content) {
        return <FileContentRenderer filename={toolInput.filePath} content={toolInput.content} />
      }
      break

    case "bash":
      if (toolInput?.command) {
        return <BashRenderer command={toolInput.command} stdout={toolMetadata?.stdout} stderr={toolMetadata?.stderr} />
      }
      break

    case "todowrite":
      if (toolMetadata?.todos) {
        return <TodoListRenderer todos={toolMetadata.todos} />
      }
      break

    case "webfetch":
      if (toolInput?.url && toolOutput) {
        return <WebFetchRenderer url={toolInput.url} content={toolOutput} format={toolInput.format || "text"} />
      }
      break

    default:
      // Generic tool output - with expandable for tools that produce small text output
      if (toolOutput) {
        return <GenericToolOutputRenderer toolName={toolName} toolOutput={toolOutput} />
      }

      // Show enhanced tool name for completed tools
      if (toolName && toolStatus === "completed") {
        const displayName = toolTitle || toolName
        const timingText = executionTime ? ` (${Math.round(executionTime / 1000)}s)` : ""

        return (
          <Box background="subtle" rounded="md" p="sm">
            <Text size="xs" weight="medium" mode="subtle">
              ✓ {displayName}
              {timingText}
            </Text>
            {toolCallId && (
              <Text size="xs" mode="subtle" style={{ opacity: 0.6, marginTop: 2 }}>
                {toolCallId}
              </Text>
            )}
          </Box>
        )
      }
  }

  return null
})

ToolPartRenderer.displayName = "ToolPartRenderer"

// Generic tool output renderer with expandable functionality for small text
const GenericToolOutputRenderer = memo(({ toolName, toolOutput }: { toolName: string; toolOutput: string }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  // Tools that typically produce small, hard-to-read output
  const needsExpansion = ["task", "glob", "grep", "list"].includes(toolName) && toolOutput.length > 200

  if (!needsExpansion) {
    return (
      <Box background="subtle" rounded="md" p="sm">
        <Box mb="xs">
          <Text size="xs" weight="medium" mode="subtle">
            {toolName || "Tool"}
          </Text>
        </Box>
        <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", lineHeight: 16 }}>
          {toolOutput}
        </Text>
      </Box>
    )
  }

  return (
    <Box background="subtle" rounded="md" p="sm">
      <Box mb="xs">
        <Text size="xs" weight="medium" mode="subtle">
          {toolName || "Tool"}
        </Text>
      </Box>
      <Box style={{ maxHeight: isExpanded ? undefined : 100, overflow: "hidden" }}>
        <Text size="sm" mode="subtle" style={{ fontFamily: "monospace", lineHeight: 18 }}>
          {toolOutput}
        </Text>
      </Box>
      <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)} style={{ marginTop: 8 }}>
        <Box direction="row" center gap="xs" p="xs">
          <Text size="xs" mode="subtle" weight="medium">
            {isExpanded ? "Show less" : "Show more"}
          </Text>
          <Icon icon={Feather} name={isExpanded ? "chevron-up" : "chevron-down"} size={12} color="muted" />
        </Box>
      </TouchableOpacity>
    </Box>
  )
})

GenericToolOutputRenderer.displayName = "GenericToolOutputRenderer"

const FilePartRenderer = memo(({ part }: { part: any }) => {
  // Extract file metadata from the complete part data structure
  const filename = part.fileFilename
  const fileUrl = part.fileUrl
  const fileMime = part.fileMime
  const sourceType = part.fileSourceType // "file" or "symbol"
  const sourcePath = part.fileSourcePath
  const sourceTextStart = part.fileSourceTextStart
  const sourceTextEnd = part.fileSourceTextEnd
  const sourceName = part.fileSourceName // for symbol sources
  const sourceRange = part.fileSourceRange
    ? typeof part.fileSourceRange === "string"
      ? JSON.parse(part.fileSourceRange)
      : part.fileSourceRange
    : null

  // Enhanced file rendering with source information
  if (filename && fileUrl) {
    return (
      <Box>
        <FileContentRenderer filename={filename} content={fileUrl} />
        {/* Show additional source metadata if available */}
        {(sourceType || sourcePath || sourceName) && (
          <Box mt="xs" p="xs" background="lighter" rounded="sm">
            <Text size="xs" mode="subtle">
              {sourceType === "symbol" && sourceName && `Symbol: ${sourceName}`}
              {sourceType === "file" && sourcePath && `Path: ${sourcePath}`}
              {sourceTextStart !== null && sourceTextEnd !== null && ` (${sourceTextStart}-${sourceTextEnd})`}
              {fileMime && ` • ${fileMime}`}
            </Text>
            {sourceRange && (
              <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", marginTop: 2 }}>
                Range: {JSON.stringify(sourceRange)}
              </Text>
            )}
          </Box>
        )}
      </Box>
    )
  }

  return null
})

FilePartRenderer.displayName = "FilePartRenderer"

// Snapshot Renderer - Shows snapshot references
const SnapshotRenderer = memo(({ part }: { part: any }) => {
  const snapshotId = part.snapshotId

  if (!snapshotId) return null

  return (
    <Box background="subtle" rounded="md" p="sm">
      <Text size="xs" weight="medium" mode="subtle">
        📸 Snapshot: {snapshotId}
      </Text>
    </Box>
  )
})

SnapshotRenderer.displayName = "SnapshotRenderer"

// Patch Renderer - Shows code patches
const PatchRenderer = memo(({ part }: { part: any }) => {
  const patchHash = part.patchHash
  const patchFiles = part.patchFiles
    ? typeof part.patchFiles === "string"
      ? JSON.parse(part.patchFiles)
      : part.patchFiles
    : null

  if (!patchHash && !patchFiles) return null

  return (
    <Box background="subtle" rounded="md" p="sm">
      <Text size="xs" weight="medium" mode="subtle">
        🔧 Patch Applied
      </Text>
      {patchHash && (
        <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", marginTop: 4 }}>
          Hash: {patchHash.substring(0, 8)}...
        </Text>
      )}
      {patchFiles && Array.isArray(patchFiles) && patchFiles.length > 0 && (
        <Text size="xs" mode="subtle" style={{ marginTop: 4 }}>
          Files: {patchFiles.join(", ")}
        </Text>
      )}
    </Box>
  )
})

PatchRenderer.displayName = "PatchRenderer"

// Main item renderer - now only handles parts
const ItemRenderer = memo(({ item }: { item: any }) => {
  if (item.type === "part") {
    return <PartItem part={item} />
  }
  return null
})

ItemRenderer.displayName = "ItemRenderer"

PartItem.displayName = "PartItem"

export const StreamingMessageList = memo(
  forwardRef<StreamingMessageListRef, StreamingMessageListProps>(
    ({ sessionId, keyboardHeight, onRefresh, refreshing }, ref) => {
      const flatListRef = useRef<FlatList>(null)
      const lastScrollY = useRef(0)
      const isUserScrolling = useRef(false)

      // Get streaming state for typing indicator
      const { isStreaming, error } = useChatState(sessionId)

      // Fetch messages with parts directly from database - this is our source of truth
      const { data: messagesWithParts, isLoading, refetch: refetchParts } = useLocalSessionPartsQuery(sessionId)
      // Convert messages and parts to flat list items
      const flattenedItems = useMemo(() => {
        if (!messagesWithParts) return []

        const items: any[] = []

        // Process each message and its parts
        messagesWithParts.forEach((message: any) => {
          // Add parts for this message (if they exist)
          if (message.parts && Array.isArray(message.parts)) {
            message.parts.forEach((part: any, partIndex: number) => {
              items.push({
                type: "part",
                id: `part-${part.id}`,
                data: {
                  ...part,
                  role: message.role, // Add role from parent message
                },
                messageId: message.id,
                role: message.role,
                createdAt: part.createdAt,
                partIndex: partIndex,
              })
            })
          }
        })

        return items // Already in correct order from query
      }, [messagesWithParts])
      // Scroll to bottom helper
      const scrollToBottom = useCallback(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
      }, [])

      // Expose scrollToBottom to parent
      useImperativeHandle(ref, () => ({
        scrollToBottom,
      }))

      // Handle refresh with internal state
      const handleRefresh = useCallback(async () => {
        try {
          await onRefresh()
        } catch {
          // Handle error silently
        }
      }, [onRefresh])
      // Simplified scroll handler for keyboard dismissal
      const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const currentY = event.nativeEvent.contentOffset.y
        const deltaY = currentY - lastScrollY.current

        // Only dismiss keyboard when:
        // 1. Scrolling up (positive deltaY in inverted list)
        // 2. Not in pull-to-refresh zone (currentY > -30)
        // 3. User is actively dragging (not auto-scroll)
        if (deltaY > 8 && currentY > -30 && isUserScrolling.current) {
          Keyboard.dismiss()
        }

        lastScrollY.current = currentY
      }, [])

      // Track when user starts scrolling
      const handleScrollBeginDrag = useCallback(() => {
        isUserScrolling.current = true
      }, [])

      // Track when scrolling ends
      const handleScrollEndDrag = useCallback(() => {
        isUserScrolling.current = false
      }, []) // Render empty state
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
              <Button variant="ghost" size="sm" onPress={() => refetchParts()} style={{ marginTop: 8 }}>
                <Icon icon={Feather} name="refresh-cw" size={16} color="muted" />
                <Text mode="subtle" size="sm" weight="medium">
                  Retry
                </Text>
              </Button>
            </Box>
          </Box>
        ),
        [refetchParts],
      )

      // Render message item or part item
      const renderItem = useCallback(({ item }: { item: any }) => {
        return <ItemRenderer item={item} />
      }, [])

      // Error banner component
      const ErrorBanner = useCallback(() => {
        if (!error) return null

        return (
          <Box p="md" background="lighter" m="md" rounded="md" gap="sm">
            <Box direction="row" center gap="sm">
              <Icon icon={Feather} name="alert-circle" size={16} color="muted" />
              <Text mode="subtle" size="sm" weight="medium" style={{ flex: 1 }}>
                Connection issue - some messages may not load
              </Text>
            </Box>
            <Box direction="row" gap="sm">
              <Text mode="subtle" size="xs" style={{ opacity: 0.7 }}>
                {error.length > 50 ? error.substring(0, 50) + "..." : error}
              </Text>
            </Box>
          </Box>
        )
      }, [error])

      // Show loading state
      if (isLoading) {
        return (
          <Box flex center>
            <Box animation="pulse" animationConfig={{ repeat: 3 }}>
              <Text mode="subtle">Loading messages...</Text>
            </Box>
          </Box>
        )
      }

      return (
        <Box flex>
          <ErrorBanner />
          <MemoizedFlatList
            ref={flatListRef}
            data={flattenedItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            ListEmptyComponent={renderEmptyState}
            ListHeaderComponent={<TypingIndicator isVisible={isStreaming} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                progressViewOffset={10} // Minimal pull distance
              />
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              flexGrow: 1,
              paddingTop: 140,
              paddingBottom: Math.max(120, keyboardHeight + 20),
            }}
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
            scrollEventThrottle={16}
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
              autoscrollToTopThreshold: 10,
            }}
            removeClippedSubviews={true}
            maxToRenderPerBatch={8}
            windowSize={8}
            initialNumToRender={8}
            updateCellsBatchingPeriod={100}
            disableVirtualization={false}
            legacyImplementation={false}
          />
        </Box>
      )
    },
  ),
)

StreamingMessageList.displayName = "StreamingMessageList"
