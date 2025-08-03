import * as Haptics from "expo-haptics"

/**
 * Utility functions for haptic feedback using expo-haptics
 */

export type HapticFeedbackType = "light" | "medium" | "heavy" | "selection" | "success" | "warning" | "error" | "none"

export interface HapticConfig {
  in?: HapticFeedbackType
  out?: HapticFeedbackType
}

/**
 * Triggers a light impact haptic feedback
 */
export const lightImpact = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
}

/**
 * Triggers a medium impact haptic feedback
 */
export const mediumImpact = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
}

/**
 * Triggers a heavy impact haptic feedback
 */
export const heavyImpact = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
}

/**
 * Triggers a success notification haptic feedback
 */
export const successNotification = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
}

/**
 * Triggers a warning notification haptic feedback
 */
export const warningNotification = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
}

/**
 * Triggers an error notification haptic feedback
 */
export const errorNotification = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
}

/**
 * Triggers a selection feedback
 */
export const selection = () => {
  Haptics.selectionAsync()
}

/**
 * Triggers the specified haptic feedback type
 */
export const triggerHaptic = (type: HapticFeedbackType, disabled?: boolean) => {
  if (disabled) return

  switch (type) {
    case "light":
      lightImpact()
      break
    case "medium":
      mediumImpact()
      break
    case "heavy":
      heavyImpact()
      break
    case "selection":
      selection()
      break
    case "success":
      successNotification()
      break
    case "warning":
      warningNotification()
      break
    case "error":
      errorNotification()
      break
    case "none":
    default:
      break
  }
}

/**
 * Haptics utility object containing all haptic feedback functions
 */
const haptics = {
  lightImpact,
  mediumImpact,
  heavyImpact,
  successNotification,
  warningNotification,
  errorNotification,
  selection,
  triggerHaptic,
}

export default haptics
