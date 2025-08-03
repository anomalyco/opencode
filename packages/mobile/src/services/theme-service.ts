import * as SecureStore from "expo-secure-store"
import { Appearance } from "react-native"

const STORAGE_KEY = {
  THEME_PREFERENCE: "app.theme_preference",
}

export type ThemeMode = "light" | "dark" | "system"

class ThemeService {
  private static instance: ThemeService

  private constructor() {}

  static getInstance(): ThemeService {
    if (!ThemeService.instance) {
      ThemeService.instance = new ThemeService()
    }
    return ThemeService.instance
  }

  /**
   * Save the user's theme preference
   */
  async setThemePreference(theme: ThemeMode): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEY.THEME_PREFERENCE, theme)
  }

  /**
   * Get the user's saved theme preference
   */
  async getThemePreference(): Promise<ThemeMode | null> {
    const preference = await SecureStore.getItemAsync(STORAGE_KEY.THEME_PREFERENCE)
    return preference as ThemeMode | null
  }

  /**
   * Clear the saved theme preference (reverts to system theme)
   */
  async clearThemePreference(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEY.THEME_PREFERENCE)
  }

  /**
   * Get the resolved theme based on preference and system setting
   */
  async getResolvedTheme(): Promise<"light" | "dark"> {
    const preference = await this.getThemePreference()

    if (preference === "system" || preference === null) {
      return Appearance.getColorScheme() === "dark" ? "dark" : "light"
    }

    return preference
  }

  /**
   * Check if the user has manually set a theme preference (not using system)
   */
  async hasManualThemePreference(): Promise<boolean> {
    const preference = await this.getThemePreference()
    return preference !== null && preference !== "system"
  }
}

export const themeService = ThemeService.getInstance()
