import http from "node:http"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { app } from "electron"
import { Effect, Path } from "effect"
import { DesktopPaths } from "../paths"
import { getUserShell, loadShellEnv } from "../service/shell-env"
import { registerRendererProtocol, setDockIcon, setProtocolReporter } from "../windows"
import { scoped } from "../native/logging"

// electron-context-menu attaches to every existing and future window, so it can load once the first
// window is up instead of holding up startup with its dependency tree.
export const installContextMenu = Effect.gen(function* () {
  const { default: contextMenu } = yield* Effect.promise(() => import("electron-context-menu"))
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })
})

export const prepareApplicationEnvironment = Effect.gen(function* () {
  yield* loadSystemCertificates
  yield* loadProxyEnvironment
})

export const preferApplicationEnvironment = Effect.gen(function* () {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? yield* loadShellEnv(shell) : null
  yield* Effect.sync(() => {
    if (!shellEnv?.XDG_STATE_HOME) delete process.env.XDG_STATE_HOME
    Object.assign(process.env, {
      ...shellEnv,
      OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
      OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
      OPENCODE_CLIENT: "desktop",
    })
  })
})

export const prepareDesktop = Effect.gen(function* () {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  if (app.isPackaged || process.env.OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION !== "1")
    app.setAsDefaultProtocolClient("opencode")
  const runFork = Effect.runForkWith(yield* Effect.context())
  setProtocolReporter((level, message, data) =>
    runFork(scoped("protocol", level === "error" ? Effect.logError(message, data) : Effect.logWarning(message, data))),
  )
  registerRendererProtocol(paths.rendererRoot)
  setDockIcon(path, paths)
})

export const loadProxyEnvironment = Effect.gen(function* () {
  yield* Effect.try(() => {
    ensureLoopbackNoProxy()
    // Electron 41.2 has a newer Node API than the current @types/node package.
    const proxyAwareHttp = http as typeof http & { setGlobalProxyFromEnv(): void }
    proxyAwareHttp.setGlobalProxyFromEnv()
  }).pipe(Effect.catch((error) => Effect.logWarning("failed to load proxy environment", { error })))
})

const loadSystemCertificates = Effect.try({
  try: () => {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  },
  catch: (error) => error,
}).pipe(Effect.catch((error) => Effect.logWarning("failed to load system certificates", { error })))

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  ;["NO_PROXY", "no_proxy"].forEach((key) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
    loopback.forEach((host) => {
      if (!items.some((value) => value.toLowerCase() === host)) items.push(host)
    })
    process.env[key] = items.join(",")
  })
}
