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

export interface FontSizes {
  explorer: FontSize
  editor: FontSize
  timeline: FontSize
  conversation: FontSize
}

export interface ThemeContextValue {
  theme: string | undefined
  isDark: boolean
  fontSize: FontSize
  fontSizes: FontSizes
  setTheme: (themeName: string) => void
  setDarkMode: (isDark: boolean) => void
  setFontSize: (size: FontSize) => void
  setAreaFontSize: (area: keyof FontSizes, size: FontSize) => void
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
  const [fontSizes, setFontSizes] = createSignal<FontSizes>({
    explorer: "default",
    editor: "default",
    timeline: "default",
    conversation: "default",
  })

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
    const savedFontSizes = localStorage.getItem("fontSizes")

    setIsDark(savedDarkMode === "true")
    setFontSizeSignal(savedFontSize)

    if (savedFontSizes) {
      try {
        setFontSizes(JSON.parse(savedFontSizes))
      } catch (e) {
        // ignore
      }
    }

    setTheme(savedTheme)
  })

  createEffect(() => {
    const currentTheme = theme()
    const darkMode = isDark()
    const size = fontSize()
    const sizes = fontSizes()
    if (currentTheme) {
      document.documentElement.setAttribute("data-theme", currentTheme)
      document.documentElement.setAttribute("data-dark", darkMode.toString())
      document.documentElement.setAttribute("data-font-size", size)
      document.documentElement.setAttribute("data-font-explorer", sizes.explorer)
      document.documentElement.setAttribute("data-font-editor", sizes.editor)
      document.documentElement.setAttribute("data-font-timeline", sizes.timeline)
      document.documentElement.setAttribute("data-font-conversation", sizes.conversation)
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

  const setAreaFontSize = (area: keyof FontSizes, size: FontSize) => {
    setFontSizes((prev) => {
      const updated = { ...prev, [area]: size }
      localStorage.setItem("fontSizes", JSON.stringify(updated))
      return updated
    })
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

  return (
    <ThemeContext.Provider
      value={{
        get theme() {
          return theme()
        },
        get isDark() {
          return isDark()
        },
        get fontSize() {
          return fontSize()
        },
        get fontSizes() {
          return fontSizes()
        },
        setTheme,
        setDarkMode,
        setFontSize,
        setAreaFontSize,
        previewTheme,
        clearPreview,
      }}
    >
      {props.children}
    </ThemeContext.Provider>
  )
}
