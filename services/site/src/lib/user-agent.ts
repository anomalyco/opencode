// The visitor's platform from what the browser says, with no framework code, so the static pages'
// script (src/client) can read it too. lib/platform.ts adds the server's view and the device preview's
// override, and is what the app reads.

export const platforms = ["ios", "android", "macos", "windows", "linux"] as const
export type Platform = (typeof platforms)[number]

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

/** The platform the browser reports, which can say more than its user agent. */
export function browserPlatform(): Platform | undefined {
  // iPadOS Safari reports a Mac platform and user agent, but has a touch screen.
  if (navigator.platform.toLowerCase().includes("mac") && navigator.maxTouchPoints > 1) return "ios"
  return platformFromUserAgent(navigator.userAgent)
}

/** Touch phones and tablets, which get bottom sheets: the platform, or no hover and a coarse pointer. */
export function touchDevice(platform: Platform | undefined) {
  return platform === "ios" || platform === "android" || matchMedia("(hover: none) and (pointer: coarse)").matches
}
