import type { Protocol } from "devtools-protocol"
import type { Cdp } from "./cdp"
import type { Viewport } from "./ipc"
import { devices, type Device } from "./viewport-presets"

// Apple presets select screen geometry. All pages still run Blink; expose Chromium's reduced UA and native brands.
function userAgent(profile: Device["profile"]): Protocol.Emulation.SetUserAgentOverrideRequest {
  if (profile === "desktop") return { userAgent: "" }

  const phone = profile === "phone"
  const windows = profile === "windows-tablet"
  const os = windows ? "Windows NT 10.0; Win64; x64" : "Linux; Android 10; K"

  return {
    userAgent: `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0${phone ? " Mobile" : ""} Safari/537.36`,
    platform: windows ? "Win32" : "Linux armv8l",
    userAgentMetadata: {
      platform: windows ? "Windows" : "Android",
      platformVersion: "",
      architecture: windows ? "x86" : "",
      bitness: windows ? "64" : "",
      model: "",
      mobile: phone,
      wow64: false,
      formFactors: [phone ? "Mobile" : "Tablet"],
    },
  }
}

/** The page's viewport writer serializes these CDP overrides and rolls back to Auto on failure. */
export function createDeviceEmulation(cdp: Cdp, sessions: ReadonlyMap<string, string>) {
  let applied: Device["profile"] | undefined = "desktop"

  const touch = (enabled: boolean, sessionID?: string) =>
    cdp.send("Emulation.setTouchEmulationEnabled", enabled ? { enabled, maxTouchPoints: 5 } : { enabled }, sessionID)

  function identity(profile: Device["profile"], sessionID?: string) {
    return Promise.all([
      cdp.send("Emulation.setUserAgentOverride", userAgent(profile), sessionID),
      touch(profile !== "desktop", sessionID),
    ])
  }

  const emitTouch = (enabled: boolean) =>
    cdp.send("Emulation.setEmitTouchEventsForMouse", { enabled, configuration: "mobile" })

  function onTargets<T>(send: (sessionID?: string) => Promise<T>) {
    return Promise.all([
      send(),
      ...Array.from(sessions, ([frame, id]) =>
        send(id).catch((error) => {
          if (sessions.get(frame) === id) throw error
        }),
      ),
    ])
  }

  async function apply({ viewport, scale }: { viewport: Viewport; scale: number }) {
    const device = viewport.mode === "fixed" ? devices.find((device) => device.id === viewport.preset) : undefined
    const profile = device?.profile ?? "desktop"
    const mobile = profile !== "desktop"

    if (profile !== applied) {
      // Frames that attach during these commands must read the incoming profile.
      applied = profile

      try {
        await Promise.all([onTargets((sessionID) => identity(profile, sessionID)), emitTouch(mobile)])
      } catch (error) {
        // A partial write requires an explicit reset even if the next request is Auto.
        applied = undefined
        throw error
      }
    }

    if (viewport.mode === "auto") return cdp.send("Emulation.clearDeviceMetricsOverride")

    return cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      scale,
      mobile,
      deviceScaleFactor: 0,
      dontSetVisibleSize: true,
      ...(mobile && {
        screenWidth: viewport.width,
        screenHeight: viewport.height,
        screenOrientation:
          viewport.width > viewport.height
            ? { type: "landscapePrimary", angle: 90 }
            : { type: "portraitPrimary", angle: 0 },
      }),
    } satisfies Protocol.Emulation.SetDeviceMetricsOverrideRequest)
  }

  return {
    apply,
    mobile: () => applied !== undefined && applied !== "desktop",
    frame(sessionID: string) {
      if (applied && applied !== "desktop") return identity(applied, sessionID)
    },
    capture(params: Protocol.Page.CaptureScreenshotRequest) {
      // A clipped CDP capture temporarily changes the viewport and drops the renderer's maxTouchPoints override.
      return cdp.send("Page.captureScreenshot", params).finally(() => {
        if (applied && applied !== "desktop") return onTargets((sessionID) => touch(true, sessionID))
      })
    },
    // Chromium's mouse-to-touch converter consumes synthetic mouse events without acknowledging them to CDP.
    // User input gets touch gestures; browser tools retain their explicit mouse buttons, hover and drag semantics.
    async mouse<T>(action: () => Promise<T>) {
      if (!applied || applied === "desktop") return action()
      await emitTouch(false)

      try {
        return await action()
      } finally {
        await emitTouch(true)
      }
    },
  }
}
