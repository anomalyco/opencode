/**
 * Whether this launch makes itself the handler of `opencode://` links. A machine has one handler, so a source build
 * that registered would take the links away from the installed app. It registers only when
 * `OPENCODE_DESKTOP_REGISTER_PROTOCOL=1` asks.
 */
export function registersProtocol(build: { readonly packaged: boolean }, value?: string) {
  return build.packaged || value === "1"
}

/**
 * The arguments for `app.setAsDefaultProtocolClient`. A packaged app is its own executable. A source build runs inside
 * the Electron binary, and Windows starts exactly the command it was given: without the app's folder a link opens a
 * bare Electron and nothing happens. macOS finds the handler by bundle identifier and Linux by desktop file, so a path
 * and arguments change nothing there.
 */
export function protocolClient(build: {
  readonly packaged: boolean
  readonly platform: NodeJS.Platform
  readonly execPath: string
  readonly appPath: string
}): [protocol: string, path?: string, args?: string[]] {
  if (build.packaged || build.platform !== "win32") return ["opencode"]

  return ["opencode", build.execPath, [build.appPath]]
}

/** The links among a launch's arguments. A source build's launch also carries the app's folder and Chromium switches. */
export function deepLinkArguments(argv: readonly string[]) {
  return argv.filter((arg) => arg.startsWith("opencode://"))
}
