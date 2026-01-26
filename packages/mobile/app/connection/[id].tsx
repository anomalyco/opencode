import { useEffect, useState } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
  Alert,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useConnections } from "../../src/stores/connections"
import type { ConnectionType } from "../../src/lib/types"

const CONNECTION_TYPES: Array<{
  type: ConnectionType
  label: string
  icon: keyof typeof Ionicons.glyphMap
}> = [
  { type: "local", label: "Local", icon: "wifi" },
  { type: "tunnel", label: "Tunnel", icon: "globe" },
  { type: "cloud", label: "Cloud", icon: "cloud" },
]

export default function EditConnectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"

  const { connections, updateConnection, removeConnection, testConnection } = useConnections()

  const connection = connections.find((c) => c.id === id)

  const [type, setType] = useState<ConnectionType>(connection?.type || "local")
  const [name, setName] = useState(connection?.name || "")
  const [url, setUrl] = useState(connection?.url || "")
  const [directory, setDirectory] = useState(connection?.directory || "")
  const [username, setUsername] = useState(connection?.username || "")
  const [password, setPassword] = useState("")
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (connection) {
      setType(connection.type)
      setName(connection.name)
      setUrl(connection.url)
      setDirectory(connection.directory || "")
      setUsername(connection.username || "")
    }
  }, [connection])

  if (!connection) {
    return (
      <View style={[styles.container, isDark && styles.containerDark, styles.center]}>
        <Text style={[styles.errorText, isDark && styles.textDark]}>Connection not found</Text>
      </View>
    )
  }

  const handleTest = async () => {
    if (!url.trim()) {
      Alert.alert("Error", "Please enter a server URL")
      return
    }

    setIsTesting(true)
    const success = await testConnection(
      {
        id: connection.id,
        name: name || "Test",
        type,
        url: url.trim(),
        directory: directory.trim() || undefined,
        username: username.trim() || undefined,
      },
      password || undefined,
    )
    setIsTesting(false)

    Alert.alert(
      success ? "Success" : "Failed",
      success ? "Connection successful!" : "Could not connect to the server. Check the URL and credentials.",
    )
  }

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Please enter a connection name")
      return
    }
    if (!url.trim()) {
      Alert.alert("Error", "Please enter a server URL")
      return
    }

    setIsSaving(true)
    await updateConnection(connection.id, {
      name: name.trim(),
      type,
      url: url.trim(),
      directory: directory.trim() || undefined,
      username: username.trim() || undefined,
    })
    setIsSaving(false)
    router.back()
  }

  const handleDelete = () => {
    Alert.alert("Delete Connection", `Are you sure you want to delete "${connection.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await removeConnection(connection.id)
          router.back()
        },
      },
    ])
  }

  return (
    <ScrollView
      style={[styles.container, isDark && styles.containerDark]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Connection Type */}
      <Text style={[styles.label, isDark && styles.labelDark]}>Connection Type</Text>
      <View style={styles.typeContainer}>
        {CONNECTION_TYPES.map((t) => (
          <TouchableOpacity
            key={t.type}
            style={[
              styles.typeOption,
              isDark && styles.typeOptionDark,
              type === t.type && styles.typeOptionSelected,
              type === t.type && isDark && styles.typeOptionSelectedDark,
            ]}
            onPress={() => setType(t.type)}
          >
            <Ionicons
              name={t.icon}
              size={20}
              color={type === t.type ? (isDark ? "#0a0a0a" : "#ffffff") : isDark ? "#888888" : "#666666"}
            />
            <Text
              style={[
                styles.typeLabel,
                isDark && styles.textDark,
                type === t.type && styles.typeLabelSelected,
                type === t.type && isDark && styles.typeLabelSelectedDark,
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Name */}
      <Text style={[styles.label, isDark && styles.labelDark]}>Name</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="My Server"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={name}
        onChangeText={setName}
      />

      {/* URL */}
      <Text style={[styles.label, isDark && styles.labelDark]}>Server URL</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="http://192.168.1.100:4096"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      {/* Directory */}
      <Text style={[styles.label, isDark && styles.labelDark]}>Project Directory (Optional)</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="/path/to/project"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={directory}
        onChangeText={setDirectory}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={[styles.hint, isDark && styles.hintDark]}>
        Leave empty to use the server's current directory. Sessions will be created in this folder.
      </Text>

      {/* Auth */}
      <Text style={[styles.sectionTitle, isDark && styles.textDark]}>Authentication</Text>

      <Text style={[styles.label, isDark && styles.labelDark]}>Username</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="admin"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.label, isDark && styles.labelDark]}>Password (leave empty to keep existing)</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="••••••••"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.testButton, isDark && styles.testButtonDark]}
          onPress={handleTest}
          disabled={isTesting}
        >
          {isTesting ? (
            <ActivityIndicator size="small" color={isDark ? "#ffffff" : "#0a0a0a"} />
          ) : (
            <>
              <Ionicons name="pulse" size={20} color={isDark ? "#ffffff" : "#0a0a0a"} />
              <Text style={[styles.testButtonText, isDark && styles.textDark]}>Test Connection</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveButton, isDark && styles.saveButtonDark]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
          ) : (
            <Text style={[styles.saveButtonText, isDark && styles.saveButtonTextDark]}>Save Changes</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
          <Text style={styles.deleteButtonText}>Delete Connection</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
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
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  errorText: {
    fontSize: 16,
    color: "#666666",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
    marginTop: 16,
    marginBottom: 8,
  },
  labelDark: {
    color: "#ffffff",
  },
  typeContainer: {
    flexDirection: "row",
    gap: 8,
  },
  typeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    gap: 6,
  },
  typeOptionDark: {
    backgroundColor: "#1a1a1a",
  },
  typeOptionSelected: {
    backgroundColor: "#0a0a0a",
  },
  typeOptionSelectedDark: {
    backgroundColor: "#ffffff",
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#666666",
  },
  textDark: {
    color: "#ffffff",
  },
  typeLabelSelected: {
    color: "#ffffff",
  },
  typeLabelSelectedDark: {
    color: "#0a0a0a",
  },
  input: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: "#0a0a0a",
  },
  inputDark: {
    backgroundColor: "#1a1a1a",
    color: "#ffffff",
  },
  hint: {
    fontSize: 13,
    color: "#666666",
    marginTop: 6,
  },
  hintDark: {
    color: "#888888",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0a0a0a",
    marginTop: 32,
    marginBottom: 8,
  },
  actions: {
    marginTop: 32,
    gap: 12,
  },
  testButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  testButtonDark: {
    borderColor: "#333333",
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  saveButton: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
  },
  saveButtonDark: {
    backgroundColor: "#ffffff",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  saveButtonTextDark: {
    color: "#0a0a0a",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fef2f2",
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ef4444",
  },
})
