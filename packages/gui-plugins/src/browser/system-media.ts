import electron from "electron"

// The system's privacy setting for the camera and microphone, and the one place the pane asks the system for them.
// Pages never reach the system before the user allowed the site in the bar: `deviceStep` decides each step from the
// site's answer and this setting, and `createSystemMedia` is the only code that calls the system.

export type MediaDevice = "camera" | "microphone"

/** What the system lets this app do with a device: use it, ask the user first (macOS only), or nothing. */
export type DeviceAccess = "granted" | "ask" | "denied"

/**
 * The app's access to a device from Electron's `getMediaAccessStatus`. macOS asks once per device (`not-determined`);
 * Windows reports its privacy switch and cannot ask from an app; Linux has no such setting.
 */
export function deviceAccess(platform: NodeJS.Platform, status: string): DeviceAccess {
  if (platform !== "darwin" && platform !== "win32") return "granted"

  if (status === "denied" || status === "restricted") return "denied"

  return platform === "darwin" && status === "not-determined" ? "ask" : "granted"
}

/** The most restrictive access among the devices a request names: one refused device refuses the request. */
export function requestAccess(access: readonly DeviceAccess[]): DeviceAccess {
  if (access.includes("denied")) return "denied"

  return access.includes("ask") ? "ask" : "granted"
}

/**
 * The next step of a camera or microphone request, from the system's access (`system`), the site's standing answer
 * (`decision`: kept, for this visit, or none; an agent-driven tab has none) and whether the user just allowed this
 * request in the bar (`allowed`):
 * - `refuse`: the system refuses the app the device, so the page is told no with the notice that names its setting,
 *   and neither the system nor the user is asked;
 * - `deny`: the site is blocked;
 * - `prompt`: the user answers in the bar first; while macOS has not asked yet, even a site the user allowed before
 *   asks again, so nothing reaches the system before a click on Allow;
 * - `ask-system`: the user allowed this request, and macOS asks now;
 * - `grant`.
 */
export function deviceStep(input: {
  readonly system: DeviceAccess
  readonly decision?: "allow" | "block"
  readonly allowed: boolean
}) {
  if (input.system === "denied") return "refuse" as const

  if (input.allowed) return input.system === "ask" ? ("ask-system" as const) : ("grant" as const)

  if (input.decision === "block") return "deny" as const

  if (input.system === "ask" || input.decision !== "allow") return "prompt" as const

  return "grant" as const
}

export type SystemMedia = ReturnType<typeof createSystemMedia>

/**
 * The system calls for media devices, each reported to `log` in development builds so a tester can see when the app
 * reads the setting and when it asks the system, which only follows a click on Allow.
 */
export function createSystemMedia(log?: (line: string) => void) {
  return {
    access(device: MediaDevice) {
      if (process.platform !== "darwin" && process.platform !== "win32") return "granted" as const
      const status = electron.systemPreferences.getMediaAccessStatus(device)
      log?.(`browser media: getMediaAccessStatus(${device}) = ${status}`)

      return deviceAccess(process.platform, status)
    },
    ask(device: MediaDevice, origin: string) {
      log?.(`browser media: askForMediaAccess(${device}) after the user allowed ${origin}`)

      return electron.systemPreferences.askForMediaAccess(device)
    },
  }
}
