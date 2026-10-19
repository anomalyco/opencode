import { PlatformProvider, type Platform } from "@/runtime/platform/platform"
import { ErrorPage } from "./error"

const desktop = {
  platform: "desktop",
  os: "windows",
  version: "2.0.32",
  windowID: "story",
  openExternal() {},
  openDirectoryPickerDialog: async () => null,
  restart: async () => {},
  restartService: () => new Promise<void>(() => {}),
  exportDebugLogs: async () => "",
  notify: async () => {},
  fetch: globalThis.fetch.bind(globalThis),
} satisfies Platform

function failure(message: string, frames: string[]) {
  const error = new Error(message)
  error.stack = [`Error: ${message}`, ...frames.map((frame) => `    at ${frame}`)].join("\n")

  return error
}

function startupFailure() {
  const error = failure("Background service failed to start", [
    "fail (packages/client/src/service-probe.ts:30:45)",
    "ensure (packages/client/src/promise/service.ts:74:41)",
  ])
  Object.defineProperty(error, "localServerStartup", { value: true })

  return error
}

const page = (platform: Platform, error: unknown) => (
  <div class="flex h-screen w-full bg-background-base">
    <PlatformProvider value={platform}>
      <ErrorPage error={error} />
    </PlatformProvider>
  </div>
)

export default {
  title: "App/Shell/Error Page",
  id: "app-shell-error-page",
  parameters: { layout: "fullscreen" },
}

export const LocalServerStartup = {
  render: () => page(desktop, startupFailure()),
}

export const UnexpectedError = {
  render: () =>
    page(
      desktop,
      failure("Cannot read properties of undefined (reading 'id')", [
        "SessionRoute (packages/app/src/session/route.tsx:88:23)",
      ]),
    ),
}
