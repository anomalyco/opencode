import React, { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import { FlatList, Alert, Pressable } from "react-native"
import { router } from "expo-router"
import { Box, Text, Icon, Button } from "@/components/ui/primitives"
import { BottomSheet, type BottomSheetRef } from "@/components/ui/primitives/bottom-sheet"
import { Feather } from "@expo/vector-icons"
import { useLocalSessionsQuery, useDeleteLocalSessionMutation } from "@/services/api/local/sessions"
import { useDeleteRemoteSessionMutation } from "@/services/api/remote/sessions"
import { useSessionManager } from "@/services/session-manager"
import type { Session } from "@/db/types"

interface SessionDialogProps {
  onClose: () => void
  currentSessionId?: string
}

export interface SessionDialogRef {
  present: () => void
  dismiss: () => void
}

interface SessionItemProps {
  session: Session
  isCurrentSession: boolean
  onPress: (sessionId: string) => void
  onDelete: (sessionId: string) => void
}

const SessionItem: React.FC<SessionItemProps> = ({ session, isCurrentSession, onPress, onDelete }) => {
  const handlePress = () => {
    onPress(session.id)
  }

  const handleDelete = () => {
    Alert.alert("Delete Session", `Are you sure you want to delete "${session.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDelete(session.id),
      },
    ])
  }

  const formatDate = (date: Date) => {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    } else if (diffDays === 1) {
      return "Yesterday"
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  return (
    <Box
      direction="row"
      alignItems="center"
      p="md"
      background={isCurrentSession ? "emphasis" : "base"}
      rounded="lg"
      style={{ opacity: isCurrentSession ? 0.8 : 1 }}
    >
      <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }} onPress={handlePress}>
        <Box
          rounded="full"
          background={isCurrentSession ? "subtle" : "dim"}
          style={{
            width: 8,
            height: 8,
            opacity: isCurrentSession ? 1 : 0.3,
          }}
        />
        <Box flex gap="xs">
          <Text size="md" weight={isCurrentSession ? "bold" : "medium"} numberOfLines={1}>
            {session.title}
          </Text>
          <Text size="sm" mode="subtle">
            {formatDate(session.timeUpdated)}
          </Text>
        </Box>
      </Pressable>

      <Button variant="ghost" size="sm" onPress={handleDelete} style={{ padding: 8 }}>
        <Icon icon={Feather} name="trash-2" size={16} color="error" />
      </Button>
    </Box>
  )
}

export const SessionDialog = forwardRef<SessionDialogRef, SessionDialogProps>(({ onClose, currentSessionId }, ref) => {
  const [isCreating, setIsCreating] = useState(false)
  const bottomSheetRef = useRef<BottomSheetRef>(null)
  const { data: sessions = [], refetch } = useLocalSessionsQuery()
  const deleteLocalSession = useDeleteLocalSessionMutation()
  const deleteRemoteSession = useDeleteRemoteSessionMutation()
  const sessionManager = useSessionManager()

  useImperativeHandle(ref, () => ({
    present: () => bottomSheetRef.current?.present(),
    dismiss: () => bottomSheetRef.current?.dismiss(),
  }))

  // Filter out child sessions (parentId !== null)
  const rootSessions = sessions.filter((session) => !session.parentId)

  const handleNewSession = useCallback(async () => {
    if (isCreating) return

    setIsCreating(true)
    try {
      await sessionManager.navigateToNewSession()
      bottomSheetRef.current?.dismiss()
      onClose()
    } catch (error) {
      Alert.alert("Error", "Failed to create new session")
    } finally {
      setIsCreating(false)
    }
  }, [isCreating, sessionManager, onClose])

  const handleSessionPress = useCallback(
    (sessionId: string) => {
      if (sessionId === currentSessionId) {
        bottomSheetRef.current?.dismiss()
        onClose()
        return
      }

      sessionManager.switchToSession(sessionId)
      bottomSheetRef.current?.dismiss()
      onClose()
    },
    [currentSessionId, sessionManager, onClose],
  )

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        // Delete from both local and remote
        await Promise.allSettled([
          deleteLocalSession.mutateAsync(sessionId),
          deleteRemoteSession.mutateAsync(sessionId),
        ])

        // If we deleted the current session, navigate to home
        if (sessionId === currentSessionId) {
          router.replace("/(app)/tabs/home" as any)
        }

        // Refresh the list
        refetch()
      } catch (error) {
        Alert.alert("Error", "Failed to delete session")
      }
    },
    [deleteLocalSession, deleteRemoteSession, currentSessionId, refetch],
  )

  const handleDismiss = () => {
    onClose()
  }

  const renderHeader = () => (
    <Box p="md" gap="md">
      <Box direction="row" alignItems="center" justifyContent="space-between">
        <Text size="lg" weight="bold">
          Switch Session
        </Text>
        <Button variant="ghost" size="sm" onPress={handleDismiss}>
          <Icon icon={Feather} name="x" size={20} color="muted" />
        </Button>
      </Box>

      <Button
        variant="outline"
        size="md"
        onPress={handleNewSession}
        disabled={isCreating}
        style={{ opacity: isCreating ? 0.6 : 1 }}
      >
        <Box direction="row" alignItems="center" gap="xs">
          <Icon icon={Feather} name="plus" size={16} color="brand" />
          <Text weight="medium">{isCreating ? "Creating..." : "New Session"}</Text>
        </Box>
      </Button>
    </Box>
  )

  const renderEmptyState = () => (
    <Box center p="lg" gap="md">
      <Icon icon={Feather} name="message-square" size={48} color="muted" />
      <Box center gap="xs">
        <Text mode="subtle" size="md" weight="medium">
          No sessions yet
        </Text>
        <Text mode="subtle" size="sm" style={{ textAlign: "center" }}>
          Create your first session to get started
        </Text>
      </Box>
    </Box>
  )

  const renderItem = ({ item }: { item: Session }) => (
    <SessionItem
      session={item}
      isCurrentSession={item.id === currentSessionId}
      onPress={handleSessionPress}
      onDelete={handleDeleteSession}
    />
  )

  return (
    <BottomSheet ref={bottomSheetRef} onDismiss={handleDismiss}>
      <Box style={{ maxHeight: "80%" }}>
        {renderHeader()}

        <Box flex p="md">
          {rootSessions.length === 0 ? (
            renderEmptyState()
          ) : (
            <FlatList
              data={rootSessions}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              ItemSeparatorComponent={() => <Box style={{ height: 8 }} />}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          )}
        </Box>
      </Box>
    </BottomSheet>
  )
})
