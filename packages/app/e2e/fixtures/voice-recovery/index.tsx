import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Route, Router } from "@solidjs/router"
import { PlatformProvider, type Platform } from "@/context/platform"
import { LanguageProvider } from "@/context/language"
import { VoiceInput } from "@/components/voice-input/input"
import { createVoiceRecorder } from "@/components/voice-input/recorder"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import type { MicrophonePlatform } from "@/voice/types"
import "@/index.css"

// Only the native OS boundary is simulated; recorder, recovery controller, and toast are real.
const [system, setSystem] = createStore({
  access: "denied" as Awaited<ReturnType<MicrophonePlatform["status"]>>,
  opened: "",
  fail: false,
  captureCalls: 0,
})
const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
navigator.mediaDevices.getUserMedia = (constraints) => {
  setSystem("captureCalls", (count) => count + 1)
  if (system.access !== "granted") return Promise.reject(new DOMException("Denied", "NotAllowedError"))
  return capture(constraints)
}
const platform: Platform = {
  platform: "desktop",
  os: "macos",
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
  openDirectoryPickerDialog: async () => null,
  microphone: {
    status: async () => system.access,
    openSettings: async (target) => {
      if (system.fail) return false
      setSystem("opened", target)
      return true
    },
  },
}
setV2Toast(true)

function Fixture() {
  const recorder = createVoiceRecorder()
  return (
    <main style={{ padding: "32px" }}>
      <VoiceInput recorder={recorder} />
      <output aria-label="Settings destination">{system.opened}</output>
      <output aria-label="Capture requests">{system.captureCalls}</output>
      <button
        onClick={() => {
          setSystem("access", "granted")
          window.dispatchEvent(new Event("focus"))
        }}
      >
        Grant access and return
      </button>
      <button onClick={() => window.dispatchEvent(new Event("focus"))}>Return without changes</button>
      <button onClick={() => setSystem("fail", true)}>Fail to open settings</button>
      <button onClick={() => setSystem("access", "restricted")}>Restrict access</button>
      <ToastRegion v2 />
    </main>
  )
}

render(
  () => (
    <PlatformProvider value={platform}>
      <LanguageProvider locale="en">
        <Router>
          <Route path="*" component={Fixture} />
        </Router>
      </LanguageProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
