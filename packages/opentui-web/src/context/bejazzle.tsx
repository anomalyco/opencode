import { createContext, useContext, type ParentComponent } from "solid-js"
import { createSignal, createEffect } from "solid-js"

export type BejazzleLevel = 0 | 1 | 2 | 3 | 4 | 5

export interface ThemeFeatures {
  roundedCorners: boolean
  gradients: boolean
  animations: boolean
  shadows: boolean
  enhancedButtons: boolean
  customScrollbars: boolean
  glowEffects: boolean
  smoothTransitions: boolean
}

export const DEFAULT_THEME: ThemeFeatures = {
  roundedCorners: true,
  gradients: true,
  animations: true,
  shadows: true,
  enhancedButtons: true,
  customScrollbars: true,
  glowEffects: true,
  smoothTransitions: true,
}

export const MINIMAL_THEME: ThemeFeatures = {
  roundedCorners: false,
  gradients: false,
  animations: false,
  shadows: false,
  enhancedButtons: false,
  customScrollbars: false,
  glowEffects: false,
  smoothTransitions: false,
}

interface BejazzleContextValue {
  bejazzleMode: () => boolean
  setBejazzleMode: (enabled: boolean) => void
  bejazzleLevel: () => BejazzleLevel
  incrementBejazzleLevel: () => void
  messageCount: () => number
  incrementMessageCount: () => void
  showBejazzleNotification: (message: string) => void
  themeFeatures: () => ThemeFeatures
  setThemeFeatures: (features: Partial<ThemeFeatures>) => void
  resetTheme: () => void
  applyPreset: (preset: "full" | "minimal") => void
}

const BejazzleContext = createContext<BejazzleContextValue>()

export const BejazzleProvider: ParentComponent = (props) => {
  // Load bejazzle mode from localStorage, default to FALSE (disabled)
  const loadBejazzleMode = (): boolean => {
    const stored = localStorage.getItem("bejazzle-mode")
    return stored === "true"
  }

  const loadBejazzleLevel = (): BejazzleLevel => {
    const stored = localStorage.getItem("bejazzle-level")
    return stored ? (parseInt(stored) as BejazzleLevel) : 5
  }

  const [bejazzleMode, setBejazzleMode] = createSignal(loadBejazzleMode())
  const [bejazzleLevel, setBejazzleLevel] = createSignal<BejazzleLevel>(loadBejazzleLevel())
  const [messageCount, setMessageCount] = createSignal(0)

  // Theme features state - when bejazzle is off, use MINIMAL_THEME
  const loadThemeFeatures = (): ThemeFeatures => {
    const stored = localStorage.getItem("bejazzle-theme-features")
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch {
        return MINIMAL_THEME
      }
    }
    // Default to minimal theme when starting fresh
    return MINIMAL_THEME
  }

  const [themeFeatures, setThemeFeaturesSignal] = createSignal<ThemeFeatures>(loadThemeFeatures())

  createEffect(() => {
    localStorage.setItem("bejazzle-mode", String(bejazzleMode()))
    localStorage.setItem("bejazzle-level", String(bejazzleLevel()))
    localStorage.setItem("bejazzle-message-count", String(messageCount()))
    localStorage.setItem("bejazzle-theme-features", JSON.stringify(themeFeatures()))

    // Update data attributes on document root for CSS targeting
    const features = themeFeatures()
    const root = document.documentElement
    root.dataset.roundedCorners = String(features.roundedCorners)
    root.dataset.gradients = String(features.gradients)
    root.dataset.animations = String(features.animations)
    root.dataset.shadows = String(features.shadows)
    root.dataset.enhancedButtons = String(features.enhancedButtons)
    root.dataset.customScrollbars = String(features.customScrollbars)
    root.dataset.glowEffects = String(features.glowEffects)
    root.dataset.smoothTransitions = String(features.smoothTransitions)
  })

  const incrementBejazzleLevel = () => {
    setBejazzleLevel((prev) => Math.min(5, prev + 1) as BejazzleLevel)
  }

  const incrementMessageCount = () => {
    setMessageCount((prev) => prev + 1)
  }

  const showBejazzleNotification = (message: string) => {
    const notification = document.createElement("div")
    notification.className = "bejazzle-notification"
    notification.textContent = message
    document.body.appendChild(notification)
    setTimeout(() => notification.remove(), 2000)
  }

  const setThemeFeatures = (features: Partial<ThemeFeatures>) => {
    setThemeFeaturesSignal((prev) => ({ ...prev, ...features }))
  }

  const resetTheme = () => {
    setThemeFeaturesSignal(DEFAULT_THEME)
    showBejazzleNotification("Theme reset to default")
  }

  const applyPreset = (preset: "full" | "minimal") => {
    const newTheme = preset === "full" ? DEFAULT_THEME : MINIMAL_THEME
    setThemeFeaturesSignal(newTheme)
    showBejazzleNotification(`Applied ${preset} theme preset`)
  }

  return (
    <BejazzleContext.Provider
      value={{
        bejazzleMode,
        setBejazzleMode,
        bejazzleLevel,
        incrementBejazzleLevel,
        messageCount,
        incrementMessageCount,
        showBejazzleNotification,
        themeFeatures,
        setThemeFeatures,
        resetTheme,
        applyPreset,
      }}
    >
      {props.children}
    </BejazzleContext.Provider>
  )
}

export const useBejazzle = () => {
  const context = useContext(BejazzleContext)
  if (!context) {
    throw new Error("useBejazzle must be used within BejazzleProvider")
  }
  return context
}
