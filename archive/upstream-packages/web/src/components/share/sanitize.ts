import DOMPurify from "dompurify"

const config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "script"],
  FORBID_ATTR: ["onerror", "onload", "onclick"],
  ADD_TAGS: ["svg", "path", "span", "code", "pre"],
  ADD_ATTR: [
    "d",
    "viewBox",
    "preserveAspectRatio",
    "xmlns",
    "class",
    "style",
    "data-slot",
    "data-highlighted",
    "data-language",
    "data-line",
    "data-line-numbers",
  ],
  RETURN_TRUSTED_TYPE: false,
}

export function sanitizeHtml(html: string): string {
  if (!html) return ""
  return DOMPurify.sanitize(html, config) as string
}
