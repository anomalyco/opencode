import { eq } from "drizzle-orm"
import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { createServer } from "node:net"
import { promisify } from "node:util"
import type { DesktopStorage } from "../storage"
import { pairing } from "../storage/schema"
import { SidecarCredentials } from "./sidecar-credentials"

const tailscalePortKey = "tailscale_https_port"
const execFileAsync = promisify(execFile)

export function createPairing(storage: DesktopStorage.Interface) {
  let tailscale: Promise<string | undefined> | undefined
  const getTailscale = () => (tailscale ??= resolveTailscale())
  let tailscalePort: Promise<number> | undefined
  const storedTailscalePort = () => {
    const value = storage.db
      .select({ value: pairing.value })
      .from(pairing)
      .where(eq(pairing.key, tailscalePortKey))
      .get()?.value
    if (!value) return
    const port = Number(value)
    if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
  }
  const getTailscalePort = () => (tailscalePort ??= Promise.resolve(storedTailscalePort() ?? availablePort()))
  const saveTailscalePort = (port: number) =>
    storage.db
      .insert(pairing)
      .values({ key: tailscalePortKey, value: String(port) })
      .onConflictDoUpdate({ target: pairing.key, set: { value: String(port) } })
      .run()

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
  const serveTailscale = async (executable: string, port: number) => {
    const credentials = requireCredentials()
    const local = await readInfo(credentials)
    const endpoint = new URL(credentials.url)
    const options = { env: { ...process.env, TAILSCALE_BE_CLI: "1" }, windowsHide: true }
    const served = await execFileAsync(
      executable,
      ["serve", `--https=${port}`, "--bg", "--yes", `http://127.0.0.1:${endpoint.port}`],
      options,
    )
    saveTailscalePort(port)
    const direct = tailscaleUrls(`${served.stdout}\n${served.stderr}`, port)
    const urls = direct.length
      ? direct
      : tailscaleUrls(
          await execFileAsync(executable, ["serve", "status"], options).then(
            (result) => `${result.stdout}\n${result.stderr}`,
          ),
          port,
        )
    if (!urls.length) throw new Error("Tailscale Serve did not report an HTTPS address")
    return { ...local, urls: [...urls, ...local.urls] }
  }

  return {
    info,
    async tailscaleAvailable() {
      return (await getTailscale()) !== undefined
    },
    async tailscaleStatus() {
      const executable = await getTailscale()
      const port = storedTailscalePort()
      if (!executable || !port) return null
      return serveTailscale(executable, port)
    },
    async openTailscale() {
      const executable = await getTailscale()
      if (!executable) throw new Error("Tailscale is not installed")
      return serveTailscale(executable, await getTailscalePort())
    },
    async disableTailscale() {
      const executable = await getTailscale()
      const port = storedTailscalePort()
      if (!executable || !port) return
      await execFileAsync(executable, ["serve", `--https=${port}`, "--yes", "off"], {
        env: { ...process.env, TAILSCALE_BE_CLI: "1" },
        windowsHide: true,
      })
      storage.db.delete(pairing).where(eq(pairing.key, tailscalePortKey)).run()
      tailscalePort = undefined
    },
  }
}

async function resolveTailscale() {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
          ...(process.env.HOME ? [`${process.env.HOME}/Applications/Tailscale.app/Contents/MacOS/Tailscale`] : []),
          "/opt/homebrew/bin/tailscale",
          "/usr/local/bin/tailscale",
        ]
      : []
  const installed = (
    await Promise.all(
      candidates.map((file) =>
        access(file, constants.X_OK).then(
          () => file,
          () => undefined,
        ),
      ),
    )
  ).find((file) => file !== undefined)
  if (installed) return installed
  const result = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["tailscale"], {
    windowsHide: true,
  }).then(
    (value) => value.stdout,
    () => undefined,
  )
  return result
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

export function tailscaleUrls(output: string, port?: number) {
  return [
    ...new Set(
      (output.match(/https:\/\/[^\s|]+/g) ?? [])
        .map((value) => URL.parse(value.replace(/[),;]+$/, "")))
        .filter((url): url is URL => url?.protocol === "https:" && (port === undefined || url.port === String(port)))
        .map((url) => url.href.replace(/\/$/, "")),
    ),
  ]
}

function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("Could not allocate a Tailscale HTTPS port"))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}
