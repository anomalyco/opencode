import { SidecarCredentials } from "./sidecar-credentials"

export function createPairing() {
  const client = async () => {
    const credentials = SidecarCredentials.get()
    if (!credentials) throw new Error("The local desktop server is not ready")
    const { OpenCode } = await import("@opencode/client/promise")
    return OpenCode.make({
      baseUrl: credentials.url,
      headers: credentials.password
        ? { Authorization: `Basic ${Buffer.from(`opencode:${credentials.password}`).toString("base64")}` }
        : undefined,
    })
  }
  const info = async () => ({ urls: (await (await client()).server.info()).urls })
  const code = async () => (await (await client()).server.pair()).code
  return { info, code }
}
