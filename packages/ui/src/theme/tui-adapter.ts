import type { DesktopTheme, ThemeVariant, HexColor, ColorValue } from "./types"

type TuiColorValue = string | { dark: string; light: string }
export interface TuiTheme {
  defs?: Record<string, string>
  theme: Record<string, TuiColorValue | undefined>
}

function resolve(tui: TuiTheme, key: string, mode: "dark" | "light", fallback: HexColor): HexColor {
  const v = tui.theme[key]
  if (!v) return fallback
  if (typeof v === "object") {
    const ref = mode === "dark" ? v.dark : v.light
    return (ref.startsWith("#") ? ref : (tui.defs?.[ref] ?? fallback)) as HexColor
  }
  return (v.startsWith("#") ? v : (tui.defs?.[v] ?? fallback)) as HexColor
}

export function tuiToDesktop(tui: TuiTheme, id: string): DesktopTheme {
  const variant = (mode: "dark" | "light"): ThemeVariant => {
    const r = (k: string, f: HexColor) => resolve(tui, k, mode, f)
    const dark = mode === "dark"

    const defaults = dark
      ? {
          bg: "#1a1b26" as HexColor,
          primary: "#7aa2f7" as HexColor,
          success: "#9ece6a" as HexColor,
          warning: "#e0af68" as HexColor,
          error: "#f7768e" as HexColor,
          info: "#7dcfff" as HexColor,
          diffAdd: "#4fd6be" as HexColor,
          diffDel: "#c53b53" as HexColor,
          muted: "#565f89" as HexColor,
        }
      : {
          bg: "#e1e2e7" as HexColor,
          primary: "#2e7de9" as HexColor,
          success: "#587539" as HexColor,
          warning: "#8c6c3e" as HexColor,
          error: "#f52a65" as HexColor,
          info: "#007197" as HexColor,
          diffAdd: "#1e725c" as HexColor,
          diffDel: "#c53b53" as HexColor,
          muted: "#8990a3" as HexColor,
        }

    return {
      seeds: {
        neutral: r("background", defaults.bg),
        primary: r("primary", defaults.primary),
        success: r("success", defaults.success),
        warning: r("warning", defaults.warning),
        error: r("error", defaults.error),
        info: r("info", defaults.info),
        interactive: r("primary", defaults.primary),
        diffAdd: r("diffAdded", defaults.diffAdd),
        diffDelete: r("diffRemoved", defaults.diffDel),
      },
      overrides: {
        "syntax-comment": r("syntaxComment", defaults.muted) as ColorValue,
        "syntax-keyword": r("syntaxKeyword", defaults.primary) as ColorValue,
        "syntax-string": r("syntaxString", defaults.success) as ColorValue,
        "syntax-variable": r("syntaxVariable", defaults.error) as ColorValue,
        "syntax-type": r("syntaxType", defaults.warning) as ColorValue,
        "syntax-constant": r("syntaxNumber", defaults.warning) as ColorValue,
        "syntax-primitive": r("syntaxFunction", defaults.info) as ColorValue,
        "syntax-operator": r("syntaxOperator", defaults.muted) as ColorValue,
        "syntax-punctuation": r("syntaxPunctuation", defaults.muted) as ColorValue,
        "markdown-heading": r("markdownHeading", defaults.primary) as ColorValue,
        "markdown-text": r("markdownText", dark ? ("#eeeeee" as HexColor) : ("#1a1a1a" as HexColor)) as ColorValue,
        "markdown-link": r("markdownLink", defaults.primary) as ColorValue,
        "markdown-link-text": r("markdownLinkText", defaults.info) as ColorValue,
        "markdown-code": r("markdownCode", defaults.success) as ColorValue,
        "markdown-block-quote": r("markdownBlockQuote", defaults.warning) as ColorValue,
        "markdown-emph": r("markdownEmph", defaults.warning) as ColorValue,
        "markdown-strong": r("markdownStrong", defaults.warning) as ColorValue,
        "markdown-horizontal-rule": r("markdownHorizontalRule", defaults.muted) as ColorValue,
        "markdown-list-item": r("markdownListItem", defaults.primary) as ColorValue,
        "markdown-list-enumeration": r("markdownListEnumeration", defaults.info) as ColorValue,
        "markdown-image": r("markdownImage", defaults.primary) as ColorValue,
        "markdown-image-text": r("markdownImageText", defaults.info) as ColorValue,
        "markdown-code-block": r(
          "markdownCodeBlock",
          dark ? ("#eeeeee" as HexColor) : ("#1a1a1a" as HexColor),
        ) as ColorValue,
      },
    }
  }

  return {
    name: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    id,
    dark: variant("dark"),
    light: variant("light"),
  }
}
