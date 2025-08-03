import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from "@react-navigation/native"
import { useTheme } from "./theme-context"
import { lightTheme, darkTheme } from "@/config/theme"

// Create navigation themes from custom themes
const customLightNavigationTheme = {
  dark: false,
  colors: {
    primary: lightTheme.colors.primary[500],
    background: lightTheme.colors.background.default,
    card: lightTheme.colors.background.default,
    text: lightTheme.colors.text.default,
    border: lightTheme.colors.border.default,
    notification: lightTheme.colors.secondary[500],
  },
  fonts: DefaultTheme.fonts, // Use default fonts
}

const customDarkNavigationTheme = {
  dark: true,
  colors: {
    primary: darkTheme.colors.primary[500],
    background: darkTheme.colors.background.default,
    card: darkTheme.colors.background.default,
    text: darkTheme.colors.text.default,
    border: darkTheme.colors.border.default,
    notification: darkTheme.colors.secondary[500],
  },
  fonts: DarkTheme.fonts, // Use default fonts
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { currentTheme, isThemeReady } = useTheme()

  // Don't render until theme is ready to prevent flash
  if (!isThemeReady) {
    return null
  }

  return (
    <NavigationThemeProvider value={currentTheme === "dark" ? customDarkNavigationTheme : customLightNavigationTheme}>
      {children}
    </NavigationThemeProvider>
  )
}
