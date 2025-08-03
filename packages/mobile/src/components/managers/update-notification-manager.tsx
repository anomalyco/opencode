import { useEffect, useRef, useCallback, memo } from "react"
import * as Updates from "expo-updates"
import { useSonner } from "@/hooks/use-sonner"
import { Ionicons } from "@expo/vector-icons"
import * as Haptics from "expo-haptics"
import { AppState } from "react-native"

const UpdateNotificationManagerComponent = () => {
  const sonner = useSonner()
  const updateNotificationId = useRef<string | null>(null)
  const hasShownNotification = useRef(false)
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Async function to check for updates without blocking the UI
  const checkForUpdates = useCallback(async () => {
    try {
      if (__DEV__ || hasShownNotification.current) return

      // Check if update is already pending (downloaded but not applied)
      const updateCheck = await Updates.checkForUpdateAsync()

      if (updateCheck.isAvailable) {
        hasShownNotification.current = true
        updateNotificationId.current = sonner.info("Update available", {
          persistent: true,
          icon: {
            component: Ionicons,
            name: "download-outline",
            size: 20,
          },
          onPress: () => handleUpdatePress(),
        })
      }
    } catch (error) {
      // Error checking for updates
    }
  }, [sonner])

  const handleUpdatePress = useCallback(async () => {
    try {
      // Trigger haptic feedback
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      // Show downloading state
      if (updateNotificationId.current) {
        sonner.update(updateNotificationId.current, {
          type: "loading",
          title: "Installing update...",
          persistent: true,
          onPress: undefined,
        })
      }

      // Download and apply the update
      await Updates.fetchUpdateAsync()
      await Updates.reloadAsync()
    } catch (error) {
      // Error updating app

      if (updateNotificationId.current) {
        sonner.update(updateNotificationId.current, {
          type: "error",
          title: "Update failed",
          persistent: false,
          duration: 5000,
          onPress: undefined,
        })

        // Reset for next attempt
        setTimeout(() => {
          updateNotificationId.current = null
          hasShownNotification.current = false
        }, 5000)
      }

      // Trigger haptic feedback for error
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
  }, [sonner])

  // Initial check and setup periodic checking
  useEffect(() => {
    // Check immediately on mount
    const timeoutId = setTimeout(checkForUpdates, 1000) // Delay initial check

    // Set up periodic checking every 5 minutes
    checkIntervalRef.current = setInterval(checkForUpdates, 5 * 60 * 1000)

    // Listen for app state changes to check when app becomes active
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === "active") {
        // Check for updates when app becomes active (with a small delay)
        setTimeout(checkForUpdates, 2000)
      }
    }

    const subscription = AppState.addEventListener("change", handleAppStateChange)

    return () => {
      clearTimeout(timeoutId)
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
      }
      subscription?.remove()
    }
  }, [checkForUpdates])

  // This component doesn't render anything
  return null
}

// Memoize the component to prevent unnecessary re-renders
export const UpdateNotificationManager = memo(UpdateNotificationManagerComponent)
UpdateNotificationManager.displayName = "UpdateNotificationManager"
