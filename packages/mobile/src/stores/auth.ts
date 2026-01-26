import { create } from "zustand"
import * as LocalAuthentication from "expo-local-authentication"
import * as SecureStore from "expo-secure-store"

const AUTH_SETTINGS_KEY = "opencode_auth_settings"

interface AuthSettings {
  requireBiometric: boolean
  requireBiometricForMessages: boolean
}

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  hasBiometrics: boolean
  biometricType: LocalAuthentication.AuthenticationType | null
  settings: AuthSettings
  error: string | null

  // Actions
  initialize: () => Promise<void>
  authenticate: () => Promise<boolean>
  authenticateForMessage: () => Promise<boolean>
  updateSettings: (settings: Partial<AuthSettings>) => Promise<void>
  lock: () => void
}

const DEFAULT_SETTINGS: AuthSettings = {
  requireBiometric: false,
  requireBiometricForMessages: false,
}

export const useAuth = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  hasBiometrics: false,
  biometricType: null,
  settings: DEFAULT_SETTINGS,
  error: null,

  initialize: async () => {
    try {
      set({ isLoading: true, error: null })

      // Check biometric availability
      const hasHardware = await LocalAuthentication.hasHardwareAsync()
      const isEnrolled = await LocalAuthentication.isEnrolledAsync()
      const hasBiometrics = hasHardware && isEnrolled

      let biometricType: LocalAuthentication.AuthenticationType | null = null
      if (hasBiometrics) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
        biometricType = types[0] || null
      }

      // Load settings
      const stored = await SecureStore.getItemAsync(AUTH_SETTINGS_KEY)
      const settings: AuthSettings = stored ? JSON.parse(stored) : DEFAULT_SETTINGS

      // If biometric is not required, auto-authenticate
      const isAuthenticated = !settings.requireBiometric

      set({
        hasBiometrics,
        biometricType,
        settings,
        isAuthenticated,
        isLoading: false,
      })
    } catch (error) {
      set({
        error: "Failed to initialize authentication",
        isLoading: false,
        isAuthenticated: true, // Fail open for usability
      })
    }
  },

  authenticate: async () => {
    const { settings, hasBiometrics } = get()

    if (!settings.requireBiometric || !hasBiometrics) {
      set({ isAuthenticated: true })
      return true
    }

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to access OpenCode",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      })

      if (result.success) {
        set({ isAuthenticated: true, error: null })
        return true
      }

      set({ error: result.error || "Authentication failed" })
      return false
    } catch (error) {
      set({ error: "Authentication error" })
      return false
    }
  },

  authenticateForMessage: async () => {
    const { settings, hasBiometrics, isAuthenticated } = get()

    if (!isAuthenticated) return false
    if (!settings.requireBiometricForMessages || !hasBiometrics) return true

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to send message",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      })

      return result.success
    } catch {
      return false
    }
  },

  updateSettings: async (updates) => {
    const settings = { ...get().settings, ...updates }
    await SecureStore.setItemAsync(AUTH_SETTINGS_KEY, JSON.stringify(settings))
    set({ settings })
  },

  lock: () => {
    set({ isAuthenticated: false })
  },
}))
