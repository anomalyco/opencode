import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  onMount,
  type ParentComponent,
  onCleanup,
} from "solid-js"

export interface ThemeContextValue {
  theme: string | undefined
  isDark: boolean
  setTheme: (themeName: string) => void
  setDarkMode: (isDark: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue>()

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

interface ThemeProviderProps {
  defaultTheme?: string
  defaultDarkMode?: boolean
}

const themes = ["opencode", "tokyonight", "ayu", "nord", "catppuccin"]

export const ThemeProvider: ParentComponent<ThemeProviderProps> = (props) => {
  const [theme, setThemeSignal] = createSignal<string | undefined>()
  const [isDark, setIsDark] = createSignal(props.defaultDarkMode ?? false)

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "t" && event.ctrlKey) {
      event.preventDefault()
      const current = theme()
      if (!current) return
      const index = themes.indexOf(current)
      const next = themes[(index + 1) % themes.length]
      setTheme(next)
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown)
  })

  onMount(() => {
    const savedTheme = localStorage.getItem("theme") ?? "opencode"
    const savedDarkMode = localStorage.getItem("darkMode") ?? "true"
    setIsDark(savedDarkMode === "true")
    setTheme(savedTheme)
  })

  createEffect(() => {
    const currentTheme = theme()
    const darkMode = isDark()
    if (currentTheme) {
      document.documentElement.setAttribute("data-theme", currentTheme)
      document.documentElement.setAttribute("data-dark", darkMode.toString())
    }
  })

  const setTheme = async (theme: string) => {
    setThemeSignal(theme)
    localStorage.setItem("theme", theme)
  }

  const setDarkMode = (dark: boolean) => {
    setIsDark(dark)
    localStorage.setItem("darkMode", dark.toString())
  }

  const contextValue: ThemeContextValue = {
    theme: theme(),
    isDark: isDark(),
    setTheme,
    setDarkMode,
  }

  return <ThemeContext.Provider value={contextValue}>{props.children}</ThemeContext.Provider>
}
