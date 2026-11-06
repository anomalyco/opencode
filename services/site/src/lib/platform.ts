import { getRequestEvent, isServer } from "solid-js/web"

/**
 * The visitor's platform, for OS-dependent copy (download buttons, install commands, ⌘ or Ctrl).
 * Everything that changes by OS reads it from here, so the device preview's override reaches it.
 */

export const platforms = ["ios", "android", "macos", "windows", "linux"] as const
export type Platform = (typeof platforms)[number]

/**
 * The device preview (component/site/device-preview.tsx) loads its frames with `?_device=<platform>`
 * so the server renders that platform's copy, and marks each frame with the attribute below, which
 * the page inside reads on the client (also after it changes page, when the URL no longer has the
 * parameter). Like the preview, they work on the development server only.
 */
export const platformParam = "_device"
export const platformFrameAttribute = "data-device-preview-os"
/** Dispatched on the document to open the device preview, such as from Settings or the search. */
export const devicePreviewOpenEvent = "opencode-site-device-preview-open"
/** The attribute on the device preview's frames, so the page inside knows it is a preview. */
export const devicePreviewFrame = "data-device-preview-frame"
/** True on the page shown inside the device preview, which must not open a preview of its own. */
export const inDevicePreview = () => !isServer && !!window.frameElement?.hasAttribute(devicePreviewFrame)

/** The platform from a user agent alone, so the server and the first client render agree. */
export function platformFromUserAgent(userAgent: string): Platform | undefined {
  const agent = userAgent.toLowerCase()
  // iPhone and iPad user agents mention "Mac OS X", Android ones "Linux".
  if (/iphone|ipad|ipod/.test(agent)) return "ios"
  if (agent.includes("android")) return "android"
  if (agent.includes("mac")) return "macos"
  if (agent.includes("win")) return "windows"
  if (agent.includes("linux")) return "linux"
}

/**
 * The platform for the first render, on the server and in hydration: the device preview's choice,
 * else the user agent.
 */
export function requestPlatform(): Platform | undefined {
  const override = platformOverride()
  if (override) return override
  const agent = isServer ? getRequestEvent()?.request.headers.get("user-agent") : navigator.userAgent
  return platformFromUserAgent(agent ?? "")
}

/** The platform once mounted, when the browser can say more than its user agent. */
export function detectPlatform(): Platform | undefined {
  if (isServer) return requestPlatform()
  const override = platformOverride()
  if (override) return override
  // iPadOS Safari reports a Mac platform and user agent, but has a touch screen.
  if (navigator.platform.toLowerCase().includes("mac") && navigator.maxTouchPoints > 1) return "ios"
  return platformFromUserAgent(navigator.userAgent)
}

/** Phones and tablets: they get the mobile app's button, and every desktop build as a file. */
export function isMobile(platform: Platform | undefined) {
  return platform === "ios" || platform === "android"
}

/** Apple platforms show ⌘ for shortcuts, the rest Ctrl. */
export function isApple(platform: Platform | undefined) {
  return platform === "macos" || platform === "ios"
}

export function parsePlatform(value: string | null | undefined) {
  return platforms.find((platform) => platform === value)
}

function platformOverride(): Platform | undefined {
  // The device preview is a development tool, so production never overrides the platform.
  if (!import.meta.env.DEV) return
  if (isServer) {
    const request = getRequestEvent()?.request
    if (!request) return
    return parsePlatform(new URL(request.url).searchParams.get(platformParam))
  }
  const frame = window.frameElement?.getAttribute(platformFrameAttribute)
  if (frame) return parsePlatform(frame)
  return parsePlatform(new URLSearchParams(location.search).get(platformParam))
}
