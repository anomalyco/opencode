import React, { createContext, useContext, useEffect, useState } from "react"
import { useColorScheme, Appearance } from "react-native"
import { themeService } from "@/services/theme-service"
import { UnistylesRuntime, type UnistylesThemes } from "react-native-unistyles"

type ThemeContextType = {
  currentTheme: "light" | "dark"
  changeTheme: (theme: "light" | "dark") => Promise<void>
  isThemeReady: boolean
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeContextProvider")
  }
  return context
}

export const ThemeContextProvider = ({ children }: { children: React.ReactNode }) => {
  const systemColorScheme = useColorScheme()
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">("dark")
  const [isThemeReady, setIsThemeReady] = useState(false)

  // Initialize theme from saved preference
  useEffect(() => {
    const initializeTheme = async () => {
      const resolvedTheme = await themeService.getResolvedTheme()
      setCurrentTheme(resolvedTheme)

      // Apply theme to Unistyles
      UnistylesRuntime.setTheme(resolvedTheme as keyof UnistylesThemes)

      setIsThemeReady(true)
    }

    initializeTheme()
  }, [])

  // Watch for system theme changes, but only if user hasn't manually set a preference
  useEffect(() => {
    const handleSystemThemeChange = async () => {
      const hasManualPreference = await themeService.hasManualThemePreference()

      if (!hasManualPreference) {
        // User hasn't manually set a theme, so follow system changes
        const systemTheme = systemColorScheme || "dark"
        setCurrentTheme(systemTheme)
        UnistylesRuntime.setTheme(systemTheme as keyof UnistylesThemes)
      }
    }

    if (isThemeReady) {
      handleSystemThemeChange()
    }
  }, [systemColorScheme, isThemeReady])

  const changeTheme = async (theme: "light" | "dark") => {
    // Update local state immediately for UI responsiveness
    setCurrentTheme(theme)

    // Persist the user's choice
    await themeService.setThemePreference(theme)

    // Apply theme changes
    Appearance.setColorScheme(theme)
    UnistylesRuntime.setTheme(theme)
  }

  const value: ThemeContextType = {
    currentTheme,
    changeTheme,
    isThemeReady,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
