import { createContext, useContext, type ParentProps, createMemo } from "solid-js"
import { createMediaQuery, createViewportSize, isIOSDevice, isAndroidDevice, isTauri } from "@/utils/mobile"

interface MobileContextValue {
  isMobile: boolean
  isIOS: boolean
  isAndroid: boolean
  isTauri: boolean
  isPortrait: () => boolean
  isLandscape: () => boolean
  viewportSize: () => { width: number; height: number }
}

const MobileContext = createContext<MobileContextValue>()

export function MobileProvider(props: ParentProps) {
  const ios = isIOSDevice()
  const android = isAndroidDevice()
  const tauri = isTauri()
  const isPortrait = createMediaQuery("(orientation: portrait)")
  const isLandscape = createMediaQuery("(orientation: landscape)")
  const viewportSize = createViewportSize()
  const isMobileWidth = createMediaQuery("(max-width: 767px)")

  const mobile = createMemo(() => ios || android || isMobileWidth())

  const value: MobileContextValue = {
    get isMobile() {
      return mobile()
    },
    isIOS: ios,
    isAndroid: android,
    isTauri: tauri,
    isPortrait,
    isLandscape,
    viewportSize,
  }

  return <MobileContext.Provider value={value}>{props.children}</MobileContext.Provider>
}

export function useMobile() {
  const context = useContext(MobileContext)
  if (!context) {
    throw new Error("useMobile must be used within MobileProvider")
  }
  return context
}
