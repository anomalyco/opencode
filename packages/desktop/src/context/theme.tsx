import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  onMount,
  type ParentComponent,
  onCleanup,
} from "solid-js"

export type FontSize = "smallest" | "small" | "default" | "large" | "largest"

export interface ThemeContextValue {
  theme: string | undefined
  isDark: boolean
  fontSize: FontSize
  setTheme: (themeName: string) => void
  setDarkMode: (isDark: boolean) => void
  setFontSize: (size: FontSize) => void
  previewTheme: (themeName: string, isDark: boolean) => void
  clearPreview: () => void
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

export const themes = [
  "aura",
  "ayu",
  "catppuccin",
  "cobalt2",
  "dracula",
  "everforest",
  "github",
  "gruvbox",
  "kanagawa",
  "material",
  "matrix",
  "monokai",
  "nord",
  "one-dark",
  "opencode",
  "palenight",
  "rosepine",
  "solarized",
  "synthwave84",
  "tokyonight",
  "vesper",
  "zenburn",
]

export const ThemeProvider: ParentComponent<ThemeProviderProps> = (props) => {
  const [theme, setThemeSignal] = createSignal<string | undefined>()
  const [isDark, setIsDark] = createSignal(props.defaultDarkMode ?? false)
  const [fontSize, setFontSizeSignal] = createSignal<FontSize>("default")

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
    const savedFontSize = (localStorage.getItem("fontSize") as FontSize) ?? "default"
    setIsDark(savedDarkMode === "true")
    setFontSizeSignal(savedFontSize)
    setTheme(savedTheme)
  })

  createEffect(() => {
    const currentTheme = theme()
    const darkMode = isDark()
    const size = fontSize()
    if (currentTheme) {
      document.documentElement.setAttribute("data-theme", currentTheme)
      document.documentElement.setAttribute("data-dark", darkMode.toString())
      document.documentElement.setAttribute("data-font-size", size)
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

  const setFontSize = (size: FontSize) => {
    setFontSizeSignal(size)
    localStorage.setItem("fontSize", size)
  }

  const previewTheme = (themeName: string, isDark: boolean) => {
    document.documentElement.setAttribute("data-theme", themeName)
    document.documentElement.setAttribute("data-dark", isDark.toString())
  }

  const clearPreview = () => {
    const currentTheme = theme()
    const darkMode = isDark()
    if (currentTheme) {
      document.documentElement.setAttribute("data-theme", currentTheme)
      document.documentElement.setAttribute("data-dark", darkMode.toString())
    }
  }

  const contextValue: ThemeContextValue = {
    theme: theme(),
    isDark: isDark(),
    fontSize: fontSize(),
    setTheme,
    setDarkMode,
    setFontSize,
    previewTheme,
    clearPreview,
  }

  return <ThemeContext.Provider value={contextValue}>{props.children}</ThemeContext.Provider>
}
