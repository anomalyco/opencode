/**
 * Theme preload script generator.
 *
 * Generates a minimal inline script that:
 * 1. Reads theme preferences from localStorage
 * 2. Applies cached theme CSS immediately (avoiding FOUC)
 *
 * The default (oc-1) theme is provided by `@opencode-ai/ui/styles` via `theme.css`,
 * so the preload script only runs when a non-default theme is selected.
 *
 * The script should be placed in the document <head> before any stylesheets.
 */

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
 * Generate the inline preload script.
 *
 * This script should be placed in the document <head> to avoid FOUC.
 * It reads theme preferences from localStorage and applies cached theme CSS
 * immediately.
 */
export function generatePreloadScript(): string {
  // Minified version of the preload logic
  // Variables: T=themeId, S=scheme, D=isDark, M=mode, C=css, K=cacheKey
  return `(function(){var T=localStorage.getItem("${STORAGE_KEYS.THEME_ID}");if(!T)return;var S=localStorage.getItem("${STORAGE_KEYS.COLOR_SCHEME}")||"system";var D=S==="dark"||(S==="system"&&matchMedia("(prefers-color-scheme:dark)").matches);var M=D?"dark":"light";document.documentElement.dataset.theme=T;document.documentElement.dataset.colorScheme=M;if(T==="oc-1")return;var K="${STORAGE_KEYS.THEME_CSS_PREFIX}-"+T+"-"+M;var C=localStorage.getItem(K);if(C){var s=document.createElement("style");s.id="oc-theme-preload";s.textContent=":root{color-scheme:"+M+";--text-mix-blend-mode:"+(D?"plus-lighter":"multiply")+";"+C+"}";document.head.appendChild(s)}})();`
}

/**
 * Generate a formatted (readable) version of the preload script.
 * Useful for debugging.
 */
export function generatePreloadScriptFormatted(): string {
  return `(function() {
  var THEME_KEY = "${STORAGE_KEYS.THEME_ID}";
  var SCHEME_KEY = "${STORAGE_KEYS.COLOR_SCHEME}";
  var CSS_PREFIX = "${STORAGE_KEYS.THEME_CSS_PREFIX}";

  // Only preload when a theme is selected
  var themeId = localStorage.getItem(THEME_KEY);
  if (!themeId) return;

  // Read color scheme preference
  var scheme = localStorage.getItem(SCHEME_KEY) || "system";

  // Determine if dark mode
  var isDark = scheme === "dark" ||
    (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  var mode = isDark ? "dark" : "light";

  // Set data attributes for CSS/JS reference
  document.documentElement.dataset.theme = themeId;
  document.documentElement.dataset.colorScheme = mode;

  // Default theme is handled by theme.css
  if (themeId === "oc-1") return;

  // Try to get cached CSS for this theme + mode
  var cacheKey = CSS_PREFIX + "-" + themeId + "-" + mode;
  var css = localStorage.getItem(cacheKey);

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
})();`
}
