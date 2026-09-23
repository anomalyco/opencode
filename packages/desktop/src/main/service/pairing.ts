import { SidecarCredentials } from "./sidecar-credentials"

export function createPairing() {
  const requireCredentials = () => {
    const credentials = SidecarCredentials.get()
    if (!credentials) throw new Error("The local desktop server is not ready")
    return credentials
  }
  const readInfo = async (credentials: ReturnType<typeof requireCredentials>) => {
    const { OpenCode } = await import("@opencode/client/promise")
    const info = await OpenCode.make({
      baseUrl: credentials.url,
      headers: credentials.password
        ? { Authorization: `Basic ${Buffer.from(`opencode:${credentials.password}`).toString("base64")}` }
        : undefined,
    }).server.info()
    return { urls: info.urls, username: "opencode" as const, password: credentials.password ?? "" }
  }
  const info = () => readInfo(requireCredentials())
  return { info }
}
