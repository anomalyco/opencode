import { useEffect, useCallback, useState } from "react"
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from "react-native"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSessions } from "../../src/stores/sessions"
import { useConnections } from "../../src/stores/connections"
import type { Session } from "../../src/lib/sdk"

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`

  return date.toLocaleDateString()
}

function SessionItem({ session, isDark }: { session: Session; isDark: boolean }) {
  const onPress = () => {
    router.push(`/session/${session.id}`)
  }

  // Extract short directory name from session
  const shortDir = session.directory ? session.directory.split("/").filter(Boolean).pop() : null

  return (
    <TouchableOpacity style={[styles.sessionItem, isDark && styles.sessionItemDark]} onPress={onPress}>
      <View style={styles.sessionContent}>
        <View style={styles.sessionHeader}>
          <Text style={[styles.sessionTitle, isDark && styles.textDark]} numberOfLines={1}>
            {session.title || "Untitled Session"}
          </Text>
        </View>
        <View style={styles.sessionMetaRow}>
          <Text style={[styles.sessionMeta, isDark && styles.metaDark]}>
            {formatTime(session.time.updated)}
            {session.summary && ` · ${session.summary.files} files`}
          </Text>
          {shortDir && (
            <View style={styles.sessionDirBadge}>
              <Ionicons name="folder-outline" size={12} color={isDark ? "#888888" : "#666666"} />
              <Text style={[styles.sessionDirText, isDark && styles.metaDark]}>{shortDir}</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={isDark ? "#666666" : "#999999"} />
    </TouchableOpacity>
  )
}

// Get short directory name (last folder or project name)
function getShortPath(
  project: { path?: { cwd?: string; root?: string; absolute?: string }; name?: string } | null | undefined,
): string {
  if (!project) return ""
  if (project.name) return project.name
  if (!project.path?.absolute) return ""
  const parts = project.path.absolute.split("/").filter(Boolean)
  return parts[parts.length - 1] || project.path.absolute
}

export default function SessionsScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const [showNewSession, setShowNewSession] = useState(false)
  const [customDir, setCustomDir] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  const { sessions, isLoading, error, loadSessions, createSession } = useSessions()
  const { activeConnection, client, currentProject, serverHome, refreshProject, updateConnection } = useConnections()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (client) {
      loadSessions()
      refreshProject()
    }
  }, [client])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadSessions(), refreshProject()])
    setRefreshing(false)
  }, [])

  const onCreateSession = async () => {
    const session = await createSession()
    if (session) {
      router.push(`/session/${session.id}`)
    }
  }

  const onCreateInDirectory = async (dir?: string) => {
    if (!activeConnection) return

    setIsCreating(true)

    // If a custom directory is specified, temporarily update the connection
    if (dir && dir.trim()) {
      const originalDir = activeConnection.directory
      await updateConnection(activeConnection.id, { directory: dir.trim() })

      const session = await createSession()

      // Restore original directory
      await updateConnection(activeConnection.id, { directory: originalDir })

      setIsCreating(false)
      setShowNewSession(false)
      setCustomDir("")

      if (session) {
        router.push(`/session/${session.id}`)
      }
    } else {
      const session = await createSession()
      setIsCreating(false)
      setShowNewSession(false)
      if (session) {
        router.push(`/session/${session.id}`)
      }
    }
  }

  const onFabPress = () => {
    // Quick create in current project
    onCreateSession()
  }

  const onFabLongPress = () => {
    // Show modal with more options
    setCustomDir("")
    setShowNewSession(true)
  }

  if (!activeConnection) {
    return (
      <View style={[styles.emptyContainer, isDark && styles.containerDark]}>
        <Ionicons name="server-outline" size={64} color={isDark ? "#444444" : "#cccccc"} />
        <Text style={[styles.emptyTitle, isDark && styles.textDark]}>No Connection</Text>
        <Text style={[styles.emptySubtitle, isDark && styles.metaDark]}>Add a server connection to get started</Text>
        <TouchableOpacity
          style={[styles.addButton, isDark && styles.addButtonDark]}
          onPress={() => router.push("/connection/add")}
        >
          <Text style={[styles.addButtonText, isDark && styles.addButtonTextDark]}>Add Connection</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const shortPath = getShortPath(currentProject)

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Connection indicator */}
      <TouchableOpacity
        style={[styles.connectionBar, isDark && styles.connectionBarDark]}
        onPress={() => router.push("/(tabs)/connections")}
        activeOpacity={0.7}
      >
        <View style={styles.connectionInfo}>
          <View style={[styles.connectionDot, { backgroundColor: "#22c55e" }]} />
          <Text style={[styles.connectionName, isDark && styles.textDark]} numberOfLines={1}>
            {activeConnection.name}
          </Text>
          {shortPath && (
            <>
              <Ionicons name="folder" size={14} color={isDark ? "#888888" : "#666666"} />
              <Text style={[styles.projectPath, isDark && styles.metaDark]} numberOfLines={1}>
                {shortPath}
              </Text>
            </>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color={isDark ? "#666666" : "#999999"} />
      </TouchableOpacity>

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <SessionItem session={item} isDark={isDark} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? "#ffffff" : "#0a0a0a"} />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
            </View>
          ) : (
            <View style={styles.emptyList}>
              <Text style={[styles.emptyListText, isDark && styles.metaDark]}>No sessions yet</Text>
            </View>
          )
        }
        contentContainerStyle={sessions.length === 0 ? styles.emptyContent : undefined}
      />

      {/* FAB to create new session */}
      <TouchableOpacity
        style={[styles.fab, isDark && styles.fabDark]}
        onPress={onFabPress}
        onLongPress={onFabLongPress}
        delayLongPress={500}
      >
        <Ionicons name="add" size={28} color={isDark ? "#0a0a0a" : "#ffffff"} />
      </TouchableOpacity>

      {/* New Session Info Modal */}
      <Modal visible={showNewSession} animationType="slide" transparent>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowNewSession(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, isDark && styles.textDark]}>New Session</Text>
                <TouchableOpacity onPress={() => setShowNewSession(false)}>
                  <Ionicons name="close" size={24} color={isDark ? "#ffffff" : "#0a0a0a"} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                {/* Current directory */}
                <Text style={[styles.modalLabel, isDark && styles.metaDark]}>Current Directory</Text>
                <View style={[styles.modalDirBox, isDark && styles.modalDirBoxDark]}>
                  <Ionicons name="folder" size={20} color={isDark ? "#888888" : "#666666"} />
                  <Text style={[styles.modalDirText, isDark && styles.textDark]} numberOfLines={2}>
                    {currentProject?.path?.absolute || activeConnection?.directory || "Server default"}
                  </Text>
                </View>

                {/* Custom directory input */}
                <Text style={[styles.modalLabel, isDark && styles.metaDark, { marginTop: 16 }]}>
                  Or use a different folder
                </Text>
                <TextInput
                  style={[styles.modalInput, isDark && styles.modalInputDark]}
                  placeholder={serverHome ? `${serverHome}/...` : "/path/to/project"}
                  placeholderTextColor={isDark ? "#666666" : "#999999"}
                  value={customDir}
                  onChangeText={(text) => {
                    // Expand ~ to server home directory
                    if (serverHome && text.startsWith("~/")) {
                      setCustomDir(serverHome + text.slice(1))
                    } else if (serverHome && text === "~") {
                      setCustomDir(serverHome)
                    } else {
                      setCustomDir(text)
                    }
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {/* Quick path shortcuts */}
                {serverHome && (
                  <View style={styles.pathChips}>
                    <TouchableOpacity
                      style={[styles.pathChip, isDark && styles.pathChipDark]}
                      onPress={() => setCustomDir(serverHome)}
                    >
                      <Text style={[styles.pathChipText, isDark && styles.pathChipTextDark]}>~</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pathChip, isDark && styles.pathChipDark]}
                      onPress={() => setCustomDir(serverHome + "/")}
                    >
                      <Text style={[styles.pathChipText, isDark && styles.pathChipTextDark]}>~/</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={styles.modalActions}>
                {customDir.trim() ? (
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      styles.modalButtonPrimary,
                      isDark && styles.modalButtonPrimaryDark,
                      styles.modalButtonFull,
                    ]}
                    onPress={() => onCreateInDirectory(customDir)}
                    disabled={isCreating}
                  >
                    {isCreating ? (
                      <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
                    ) : (
                      <Text style={[styles.modalButtonTextPrimary, isDark && styles.modalButtonTextPrimaryDark]}>
                        Create in {customDir.split("/").filter(Boolean).pop() || customDir}
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      styles.modalButtonPrimary,
                      isDark && styles.modalButtonPrimaryDark,
                      styles.modalButtonFull,
                    ]}
                    onPress={() => onCreateInDirectory()}
                    disabled={isCreating}
                  >
                    {isCreating ? (
                      <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
                    ) : (
                      <Text style={[styles.modalButtonTextPrimary, isDark && styles.modalButtonTextPrimaryDark]}>
                        Create Session
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  connectionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  connectionBarDark: {
    borderBottomColor: "#1a1a1a",
  },
  connectionInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  connectionUrl: {
    fontSize: 12,
    color: "#666666",
  },
  projectPath: {
    fontSize: 13,
    color: "#666666",
    flex: 1,
  },
  errorBar: {
    backgroundColor: "#fef2f2",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#fecaca",
  },
  errorText: {
    color: "#dc2626",
    fontSize: 14,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  sessionItemDark: {
    borderBottomColor: "#1a1a1a",
  },
  sessionContent: {
    flex: 1,
  },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#0a0a0a",
    marginBottom: 4,
  },
  textDark: {
    color: "#ffffff",
  },
  sessionMeta: {
    fontSize: 13,
    color: "#666666",
  },
  sessionMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sessionDirBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sessionDirText: {
    fontSize: 11,
    color: "#666666",
  },
  metaDark: {
    color: "#888888",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#ffffff",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
    color: "#0a0a0a",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666666",
    marginTop: 8,
    textAlign: "center",
  },
  addButton: {
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  addButtonDark: {
    backgroundColor: "#ffffff",
  },
  addButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  addButtonTextDark: {
    color: "#0a0a0a",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyListText: {
    fontSize: 16,
    color: "#666666",
  },
  emptyContent: {
    flex: 1,
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabDark: {
    backgroundColor: "#ffffff",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalContentDark: {
    backgroundColor: "#1a1a1a",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  modalBody: {
    marginBottom: 24,
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666666",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  modalDirBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f5f5f5",
    padding: 16,
    borderRadius: 12,
  },
  modalDirBoxDark: {
    backgroundColor: "#2a2a2a",
  },
  modalDirText: {
    fontSize: 15,
    color: "#0a0a0a",
    flex: 1,
  },
  modalInput: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: "#0a0a0a",
  },
  modalInputDark: {
    backgroundColor: "#2a2a2a",
    color: "#ffffff",
  },
  pathChips: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  pathChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#e8e5f0",
    borderRadius: 16,
  },
  pathChipDark: {
    backgroundColor: "#2a2040",
  },
  pathChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6d28d9",
  },
  pathChipTextDark: {
    color: "#c4b5fd",
  },
  modalHint: {
    fontSize: 13,
    color: "#666666",
    marginTop: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  modalButtonSecondary: {
    backgroundColor: "#f5f5f5",
  },
  modalButtonSecondaryDark: {
    backgroundColor: "#2a2a2a",
  },
  modalButtonPrimary: {
    backgroundColor: "#0a0a0a",
  },
  modalButtonPrimaryDark: {
    backgroundColor: "#ffffff",
  },
  modalButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  modalButtonTextPrimary: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  modalButtonTextPrimaryDark: {
    color: "#0a0a0a",
  },
  modalButtonFull: {
    flex: 0,
    width: "100%",
  },
})
