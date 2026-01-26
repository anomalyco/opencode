import { useEffect, type ReactNode } from "react"
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useAuth } from "../stores/auth"

interface Props {
  children: ReactNode
}

export function AuthGate({ children }: Props) {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"

  const { isAuthenticated, settings, hasBiometrics, biometricType, authenticate, error } = useAuth()

  // If biometric not required, or no biometrics available, show children
  if (!settings.requireBiometric || !hasBiometrics) {
    return <>{children}</>
  }

  // If authenticated, show children
  if (isAuthenticated) {
    return <>{children}</>
  }

  // Show auth screen
  const iconName =
    biometricType === 1 // FINGERPRINT
      ? "finger-print"
      : biometricType === 2 // FACIAL_RECOGNITION
        ? "scan"
        : "lock-closed"

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.content}>
        <Ionicons name={iconName} size={64} color={isDark ? "#ffffff" : "#0a0a0a"} />
        <Text style={[styles.title, isDark && styles.textDark]}>OpenCode Locked</Text>
        <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>Authenticate to access your sessions</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={[styles.button, isDark && styles.buttonDark]} onPress={authenticate}>
          <Ionicons name={iconName} size={24} color={isDark ? "#0a0a0a" : "#ffffff"} />
          <Text style={[styles.buttonText, isDark && styles.buttonTextDark]}>Unlock</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  content: {
    alignItems: "center",
    padding: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginTop: 24,
    color: "#0a0a0a",
  },
  textDark: {
    color: "#ffffff",
  },
  subtitle: {
    fontSize: 16,
    color: "#666666",
    marginTop: 8,
    textAlign: "center",
  },
  subtitleDark: {
    color: "#888888",
  },
  error: {
    color: "#ef4444",
    marginTop: 16,
    fontSize: 14,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 32,
    gap: 12,
  },
  buttonDark: {
    backgroundColor: "#ffffff",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  buttonTextDark: {
    color: "#0a0a0a",
  },
})
