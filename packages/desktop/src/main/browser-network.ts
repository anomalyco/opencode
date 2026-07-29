import type { BrowserProxy } from "@opencode-ai/client/node"

export async function installBrowserNetwork(input: {
  readonly proxy: BrowserProxy; readonly session: Electron.Session; readonly webContents: Electron.WebContents
}) {
  let disposed = false
  const onLogin = (
    event: Electron.Event,
    _details: Electron.LoginAuthenticationResponseDetails,
    authInfo: Electron.AuthInfo,
    callback: (username?: string, password?: string) => void,
  ) => {
    if (
      !authInfo.isProxy ||
      authInfo.scheme !== "basic" ||
      authInfo.host !== input.proxy.host ||
      authInfo.port !== input.proxy.port ||
      authInfo.realm !== "OpenCode Browser Proxy"
    )
      return
    event.preventDefault()
    callback(input.proxy.credentials.username, input.proxy.credentials.password)
  }
  const cleanup = () => {
    if (disposed) return
    disposed = true
    input.webContents.off("login", onLogin)
    void input.session.closeAllConnections()
  }

  input.webContents.on("login", onLogin)
  input.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
  return input.session
    .setProxy({ mode: "fixed_servers", proxyRules: input.proxy.url, proxyBypassRules: "<-loopback>" })
    .then(() => input.session.closeAllConnections())
    .then(
      () => cleanup,
      (error) => {
        cleanup()
        throw error
      },
    )
}
