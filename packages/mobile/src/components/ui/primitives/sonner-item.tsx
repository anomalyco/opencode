import React, { useEffect } from "react"
import { Pressable, ActivityIndicator } from "react-native"
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, runOnJS } from "react-native-reanimated"
import { Ionicons } from "@expo/vector-icons"
import { Text } from "@/components/ui/primitives"
import type { SonnerConfig } from "@/types/sonner"
import { StyleSheet, useUnistyles } from "react-native-unistyles"
import haptics from "@/utils/haptics"
import BlurView from "@/primitives/blur-view"

interface SonnerItemProps {
  sonner: SonnerConfig
  onRemove: (id: string) => void
  index: number
}

const getDefaultIconForType = (type: SonnerConfig["type"]) => {
  switch (type) {
    case "success":
      return { component: Ionicons, name: "checkmark-circle", size: 20 }
    case "error":
      return { component: Ionicons, name: "close-circle", size: 20 }
    case "warning":
      return { component: Ionicons, name: "warning", size: 18 }
    case "info":
      return { component: Ionicons, name: "information-circle", size: 20 }
    case "secondary":
      return { component: Ionicons, name: "swap-horizontal", size: 20 }
    case "loading":
      return { component: Ionicons, name: "refresh", size: 20 }
    default:
      return { component: Ionicons, name: "information-circle", size: 20 }
  }
}

const getColorForType = (type: SonnerConfig["type"], theme: any) => {
  switch (type) {
    case "success":
      return theme.colors.success.base
    case "error":
      return theme.colors.error.base
    case "warning":
      return theme.colors.warning.base
    case "info":
      return theme.colors.brand.base
    case "secondary":
      return theme.colors.secondary.base
    case "loading":
      return theme.colors.neutral.base
    default:
      return theme.colors.neutral.base
  }
}

export const SonnerItem: React.FC<SonnerItemProps> = ({ sonner, onRemove, index }) => {
  const { theme } = useUnistyles()
  const translateY = useSharedValue(-100)
  const opacity = useSharedValue(0)
  const scale = useSharedValue(0.9)
  const rotation = useSharedValue(0)
  const contentScale = useSharedValue(1)
  const animatedTop = useSharedValue(60 + index * 45) // Reduced spacing from 60 to 45

  useEffect(() => {
    // Animate in
    translateY.value = withSpring(0, {
      damping: 15,
      stiffness: 150,
    })
    opacity.value = withTiming(1, { duration: 300 })
    scale.value = withSpring(1, {
      damping: 12,
      stiffness: 150,
    })

    // Reset rotation for non-loading states
    if (sonner.type !== "loading") {
      rotation.value = 0
    }

    // Trigger haptic feedback for initial mount (only loading gets haptic on mount)
    const triggerInitialHaptic = async () => {
      try {
        if (sonner.type === "loading") {
          await haptics.selection()
        }
      } catch (error) {
        // Initial haptic error
      }
    }

    triggerInitialHaptic()

    // Auto dismiss for non-loading and non-persistent sonners
    if (sonner.type !== "loading" && !sonner.persistent) {
      const duration = sonner.duration || 3000
      const timer = setTimeout(() => {
        handleRemove()
      }, duration)

      return () => clearTimeout(timer)
    }
  }, [])

  // Animate content changes (for width transitions)
  useEffect(() => {
    contentScale.value = withSpring(0.95, { damping: 8, stiffness: 100 }, () => {
      contentScale.value = withSpring(1, { damping: 12, stiffness: 150 })
    })
  }, [sonner.title, sonner.type])

  // Trigger haptic feedback when sonner type changes (for state updates)
  useEffect(() => {
    const triggerHapticOnChange = async () => {
      try {
        switch (sonner.type) {
          case "success":
            await haptics.successNotification()
            break
          case "error":
            await haptics.errorNotification()
            break
          case "warning":
            await haptics.warningNotification()
            break
          case "info":
            await haptics.lightImpact()
            break
          // Don't trigger haptic for loading state changes
          case "loading":
            break
        }
      } catch (error) {
        // Haptic error on type change
      }
    }

    // Only trigger if it's not the initial load (skip loading state)
    if (sonner.type !== "loading") {
      triggerHapticOnChange()
    }
  }, [sonner.type])

  // Auto dismiss when sonner updates (for state changes)
  useEffect(() => {
    if (sonner.type !== "loading" && !sonner.persistent && sonner.duration) {
      const timer = setTimeout(() => {
        handleRemove()
      }, sonner.duration)

      return () => clearTimeout(timer)
    }
  }, [sonner.type, sonner.persistent, sonner.duration])

  // Animate position changes when index changes (smooth repositioning)
  useEffect(() => {
    animatedTop.value = withSpring(60 + index * 45, {
      damping: 15,
      stiffness: 150,
    })
  }, [index])

  const handleRemove = () => {
    translateY.value = withTiming(-100, { duration: 300 })
    opacity.value = withTiming(0, { duration: 300 }, () => {
      runOnJS(onRemove)(sonner.id)
    })
  }

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }))

  const positionStyle = useAnimatedStyle(() => ({
    top: animatedTop.value,
  }))

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: contentScale.value }],
  }))

  const iconColor = sonner.color || getColorForType(sonner.type, theme)
  const iconData = sonner.icon || getDefaultIconForType(sonner.type)
  const IconComponent = iconData.component

  return (
    <Animated.View style={[styles.container, animatedStyle, positionStyle]}>
      <Animated.View style={styles.centeredContainer}>
        <Animated.View style={contentAnimatedStyle}>
          <BlurView intensity={80} style={styles.blurView}>
            <Pressable
              style={styles.pressable}
              onPress={() => {
                if (sonner.onPress) {
                  sonner.onPress()
                }
                if (!sonner.persistent) {
                  handleRemove()
                }
              }}
            >
              <Animated.View style={styles.iconContainer}>
                {sonner.type === "loading" ? (
                  <ActivityIndicator size="small" color={iconColor} />
                ) : (
                  <IconComponent name={iconData.name as any} size={iconData.size || 20} color={iconColor} />
                )}
              </Animated.View>
              <Text style={styles.title} numberOfLines={1}>
                {sonner.title}
              </Text>
            </Pressable>
          </BlurView>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  centeredContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  blurView: {
    borderRadius: 9999, // fully rounded
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border.subtle,
    alignSelf: "center",
    maxWidth: "100%",
  },
  pressable: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing.sm + 2,
  },
  iconContainer: {
    backgroundColor: theme.colors.background.subtle,
    borderRadius: 100,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    margin: 3,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text.default,
    marginHorizontal: 4,
  },
}))
