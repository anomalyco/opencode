/**
 * Theme preload script generator.
 *
 * Generates a minimal inline script that:
 * 1. Reads theme preferences from localStorage
 * 2. Applies cached theme CSS immediately (avoiding FOUC)
 * 3. Falls back to embedded default theme CSS on first visit
 *
 * The script should be placed in the document <head> before any stylesheets.
 */

import { resolveThemeVariant, themeToCss } from "./resolve"
import type { DesktopTheme } from "./types"
import oc1Theme from "./themes/oc-1.json"

// Storage keys used by both the preload script and the ThemeProvider
export const STORAGE_KEYS = {
  THEME_ID: "opencode-theme-id",
  COLOR_SCHEME: "opencode-color-scheme",
  THEME_CSS_PREFIX: "opencode-theme-css",
} as const

/**
 * Get the localStorage key for cached theme CSS
 */
export function getThemeCacheKey(themeId: string, mode: "light" | "dark"): string {
  return `${STORAGE_KEYS.THEME_CSS_PREFIX}-${themeId}-${mode}`
}

/**
 * Generate the embedded default theme CSS for the preload script.
 * This is used as a fallback when no cached theme exists.
 */
function generateEmbeddedDefaults(): { light: string; dark: string } {
  const theme = oc1Theme as DesktopTheme
  const lightTokens = resolveThemeVariant(theme.light, false)
  const darkTokens = resolveThemeVariant(theme.dark, true)

  return {
    light: themeToCss(lightTokens),
    dark: themeToCss(darkTokens),
  }
}

/**
 * Generate the inline preload script.
 *
 * This script should be placed in the document <head> to avoid FOUC.
 * It reads theme preferences from localStorage and applies the theme CSS
 * immediately, falling back to an embedded default theme.
 */
export function generatePreloadScript(): string {
  const defaults = generateEmbeddedDefaults()

  // Minified version of the preload logic
  // Variables: T=themeId, S=scheme, D=isDark, M=mode, C=css, K=cacheKey
  return `(function(){var T=localStorage.getItem("${STORAGE_KEYS.THEME_ID}")||"oc-1";var S=localStorage.getItem("${STORAGE_KEYS.COLOR_SCHEME}")||"system";var D=S==="dark"||(S==="system"&&matchMedia("(prefers-color-scheme:dark)").matches);var M=D?"dark":"light";var K="${STORAGE_KEYS.THEME_CSS_PREFIX}-"+T+"-"+M;var C=localStorage.getItem(K);if(!C&&T==="oc-1"){C=D?${JSON.stringify(defaults.dark)}:${JSON.stringify(defaults.light)}}if(C){var s=document.createElement("style");s.id="oc-theme-preload";s.textContent=":root{color-scheme:"+M+";--text-mix-blend-mode:"+(D?"plus-lighter":"multiply")+";"+C+"}";document.head.appendChild(s)}document.documentElement.dataset.theme=T;document.documentElement.dataset.colorScheme=M})();`
}

/**
 * Generate a formatted (readable) version of the preload script.
 * Useful for debugging.
 */
export function generatePreloadScriptFormatted(): string {
  const defaults = generateEmbeddedDefaults()

  return `(function() {
  var THEME_KEY = "${STORAGE_KEYS.THEME_ID}";
  var SCHEME_KEY = "${STORAGE_KEYS.COLOR_SCHEME}";
  var CSS_PREFIX = "${STORAGE_KEYS.THEME_CSS_PREFIX}";

  // Read preferences from localStorage
  var themeId = localStorage.getItem(THEME_KEY) || "oc-1";
  var scheme = localStorage.getItem(SCHEME_KEY) || "system";

  // Determine if dark mode
  var isDark = scheme === "dark" ||
    (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  var mode = isDark ? "dark" : "light";

  // Try to get cached CSS for this theme + mode
  var cacheKey = CSS_PREFIX + "-" + themeId + "-" + mode;
  var css = localStorage.getItem(cacheKey);

  // Fallback to embedded default for oc-1 theme
  if (!css && themeId === "oc-1") {
    css = isDark
      ? ${JSON.stringify(defaults.dark)}
      : ${JSON.stringify(defaults.light)};
  }

  // Apply CSS if we have it
  if (css) {
    var style = document.createElement("style");
    style.id = "oc-theme-preload";
    style.textContent = ":root{" +
      "color-scheme:" + mode + ";" +
      "--text-mix-blend-mode:" + (isDark ? "plus-lighter" : "multiply") + ";" +
      css +
    "}";
    document.head.appendChild(style);
  }

  // Set data attributes for CSS/JS reference
  document.documentElement.dataset.theme = themeId;
  document.documentElement.dataset.colorScheme = mode;
})();`
}
