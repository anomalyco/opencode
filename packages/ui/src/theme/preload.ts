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
 * Static tokens that don't change between themes.
 * These are embedded in the preload CSS.
 */
const STATIC_TOKENS = `--font-family-sans:"Inter","Inter Fallback";--font-family-sans--font-feature-settings:"ss03" 1;--font-family-mono:"IBM Plex Mono","IBM Plex Mono Fallback";--font-family-mono--font-feature-settings:"ss01" 1;--font-size-small:13px;--font-size-base:14px;--font-size-large:16px;--font-size-x-large:20px;--font-weight-regular:400;--font-weight-medium:500;--line-height-large:150%;--line-height-x-large:180%;--line-height-2x-large:200%;--letter-spacing-normal:0;--letter-spacing-tight:-0.16;--letter-spacing-tightest:-0.32;--paragraph-spacing-base:0;--spacing:0.25rem;--breakpoint-sm:40rem;--breakpoint-md:48rem;--breakpoint-lg:64rem;--breakpoint-xl:80rem;--breakpoint-2xl:96rem;--container-3xs:16rem;--container-2xs:18rem;--container-xs:20rem;--container-sm:24rem;--container-md:28rem;--container-lg:32rem;--container-xl:36rem;--container-2xl:42rem;--container-3xl:48rem;--container-4xl:56rem;--container-5xl:64rem;--container-6xl:72rem;--container-7xl:80rem;--radius-xs:0.125rem;--radius-sm:0.25rem;--radius-md:0.375rem;--radius-lg:0.5rem;--radius-xl:0.625rem;--shadow-xs:0 1px 2px -1px rgba(19,16,16,0.04),0 1px 2px 0 rgba(19,16,16,0.06),0 1px 3px 0 rgba(19,16,16,0.08);--shadow-md:0 6px 8px -4px rgba(19,16,16,0.12),0 4px 3px -2px rgba(19,16,16,0.12),0 1px 2px -1px rgba(19,16,16,0.12)`

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
  return `(function(){var T=localStorage.getItem("${STORAGE_KEYS.THEME_ID}")||"oc-1";var S=localStorage.getItem("${STORAGE_KEYS.COLOR_SCHEME}")||"system";var D=S==="dark"||(S==="system"&&matchMedia("(prefers-color-scheme:dark)").matches);var M=D?"dark":"light";var K="${STORAGE_KEYS.THEME_CSS_PREFIX}-"+T+"-"+M;var C=localStorage.getItem(K);if(!C&&T==="oc-1"){C=D?${JSON.stringify(defaults.dark)}:${JSON.stringify(defaults.light)}}if(C){var s=document.createElement("style");s.id="oc-theme-preload";s.textContent=":root{${STATIC_TOKENS};color-scheme:"+M+";--text-mix-blend-mode:"+(D?"plus-lighter":"multiply")+";"+C+"}";document.head.appendChild(s)}document.documentElement.dataset.theme=T;document.documentElement.dataset.colorScheme=M})();`
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
      "${STATIC_TOKENS};" +
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
