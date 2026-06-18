import DOMPurify from "dompurify"

export const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  ADD_ATTR: ["target", "rel"],
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

export function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}
