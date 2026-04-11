const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  "ar",
  "arc",
  "dv",
  "fa",
  "ha",
  "he",
  "khw",
  "ks",
  "ku",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
])

export function isRtl(lang: string) {
  const code = lang.split("-")[0]?.toLowerCase() ?? ""
  return RTL_LANGUAGES.has(code)
}

export function direction(lang: string) {
  return isRtl(lang) ? "rtl" : "ltr"
}