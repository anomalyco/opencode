;(function () {
  // Keep in sync with packages/ui/src/theme/pin.ts
  var THEME_ID = "codle"
  var COLOR_SCHEME = "system"
  var themeKey = "opencode-theme-id"
  var schemeKey = "opencode-color-scheme"

  if (localStorage.getItem(themeKey) !== THEME_ID) {
    localStorage.setItem(themeKey, THEME_ID)
  }

  if (localStorage.getItem(schemeKey) !== COLOR_SCHEME) {
    localStorage.setItem(schemeKey, COLOR_SCHEME)
  }

  var themeId = THEME_ID
  var scheme = COLOR_SCHEME
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
