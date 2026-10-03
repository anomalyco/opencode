import { randomUUID } from "node:crypto"

export interface PairingInfo {
  urls: string[]
  username: string
  password: string
}

export function generateEphemeralPassword(): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
  let pw = ""
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  for (const b of buf) pw += chars[b % chars.length]
  return pw
}

export interface AddressInfo {
  name: string
  address: string
  family: "private" | "tailnet" | "public" | "loopback"
}

export function resolveAddresses(): AddressInfo[] {
  const interfaces = new Map<string, AddressInfo[]>()
  try {
    const os = require("os") as typeof import("os")
    for (const [name, addrs] of Object.entries(
      os.networkInterfaces()
    )) {
      if (!addrs) continue
      for (const a of addrs) {
        if (a.family === "IPv4" && !a.internal) {
          let scope: AddressInfo["family"] = "private"
          if (name.toLowerCase().includes("tailscale") || name.toLowerCase().includes("wg")) {
            scope = "tailnet"
          } else if (a.address.startsWith("127.")) {
            scope = "loopback"
          } else if (a.address.startsWith("10.") || a.address.startsWith("192.168.") || a.address.startsWith("172.")) {
            scope = "private"
          } else {
            scope = "public"
          }
          const info: AddressInfo = { name, address: a.address, family: scope }
          const list = interfaces.get(name) ?? []
          list.push(info)
          interfaces.set(name, list)
        }
      }
    }
  } catch {
    // os.networkInterfaces may not be available in all runtimes
  }
  const all: AddressInfo[] = []
  for (const list of interfaces.values()) all.push(...list)
  // Order: loopback first, then tailnet, private, public
  const order: Record<AddressInfo["family"], number> = {
    loopback: 0, tailnet: 1, private: 2, public: 3,
  }
  all.sort((a, b) => order[a.family] - order[b.family])
  return all
}

export function buildPairingPayload(
  addresses: AddressInfo[],
  port: number,
  password: string,
): PairingInfo {
  // Prefer non-loopback URLs; fall back to localhost
  const urls = addresses
    .filter((a) => a.family !== "loopback")
    .map((a) => `http://${a.address}:${port}`)
  const fallback = `http://127.0.0.1:${port}`
  return {
    urls: urls.length > 0 ? [...urls, fallback] : [fallback],
    username: "",
    password,
  }
}

// Unicode block QR rendering (no external dependency)
const QR_VERSION = 1
const MODULES_PER_SIDE = 21 // Version 1

const QR_MASK_PATTERN = (i: number, j: number) => (i + j) % 2 === 0

export function renderQrPairing(payload: PairingInfo): string {
  const data = JSON.stringify(payload)
  const bits = data.split("").reduce((acc, ch) => {
    const bin = ch.charCodeAt(0).toString(2).padStart(8, "0")
    return acc + bin
  }, "")
  // Pad to fit version-1 capacity (simple approach: use all bits, pad with 0)
  const padded = bits.padEnd(MODULES_PER_SIDE * MODULES_PER_SIDE * 0.8, "0")
  const grid: boolean[][] = []
  for (let i = 0; i < MODULES_PER_SIDE; i++) {
    grid[i] = []
    for (let j = 0; j < MODULES_PER_SIDE; j++) {
      grid[i][j] = false
    }
  }
  // Finder patterns (top-left, top-right, bottom-left)
  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isEdge = r === 0 || r === 6 || c === 0 || c === 6
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4
        grid[r0 + r][c0 + c] = isEdge || isInner
      }
    }
  }
  drawFinder(0, 0)
  drawFinder(0, MODULES_PER_SIDE - 7)
  drawFinder(MODULES_PER_SIDE - 7, 0)
  // Fill data modules (simple row-by-row, skipping finder zones)
  let bitIdx = 0
  for (let col = MODULES_PER_SIDE - 1; col >= 0; col -= 2) {
    for (let row = 0; row < MODULES_PER_SIDE; row++) {
      for (const c of [col, col - 1]) {
        if (c < 0) continue
        if (grid[row][c]) continue // finder reserved
        if (bitIdx < padded.length && padded[bitIdx] === "1") {
          grid[row][c] = true
        }
        bitIdx++
      }
    }
  }
  // Render as unicode blocks
  const dark = "█"
  const light = "  "
  const lines: string[] = []
  for (let r = 0; r < MODULES_PER_SIDE; r++) {
    let line = ""
    for (let c = 0; c < MODULES_PER_SIDE; c++) {
      line += grid[r][c] ? dark : light
    }
    lines.push(line)
  }
  // Add info line
  lines.push("")
  lines.push(
    `  ${payload.urls[0]} (password: ${payload.password})`
  )
  lines.push(`  Scan with OpenCode app → Pairing`)
  return lines.join("\n")
}
