import type { JSX } from "solid-js"

export type BackgroundFit = "cover" | "contain" | "repeat"

export type BackgroundSettings = {
  enabled: boolean
  image: string
  opacity: number
  blur: number
  fit: BackgroundFit
}

export function backgroundStyle(settings: BackgroundSettings, localFileUrl = fileUrl): JSX.CSSProperties {
  if (!settings.enabled || !settings.image.trim()) return {}

  const repeat = settings.fit === "repeat"
  return {
    "background-image": `url("${localFileUrl(settings.image)}")`,
    "background-size": repeat ? "auto" : settings.fit,
    "background-repeat": repeat ? "repeat" : "no-repeat",
    "background-position": "center",
    opacity: settings.opacity,
    ...(settings.blur > 0
      ? {
          filter: `blur(${settings.blur}px)`,
          transform: "scale(1.02)",
        }
      : {}),
  }
}

function fileUrl(path: string) {
  if (/^[a-z]+:\/\//i.test(path)) return path
  const normalized = path.replaceAll("\\", "/")
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`
  return `file://${encodeURI(prefixed)}`
}
