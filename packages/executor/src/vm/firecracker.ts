import { execFileSync, spawn, type ChildProcess } from "child_process"
import { createServer } from "net"
import { stat } from "fs/promises"
import { join } from "path"
import { request as httpRequest } from "node:http"

const FC_SOCKET_WAIT_MS = Number(process.env.FC_SOCKET_WAIT_MS ?? "60000")
const VM_MEMORY_MIB = Number(process.env.VM_MEMORY_MIB ?? "1024")
const VM_CPUS = Number(process.env.VM_CPUS ?? "1")
const SSH_HOST = process.env.SSH_HOST ?? "127.0.0.1"
const SOCAT_PATH = process.env.SOCAT_PATH?.trim() || "socat"
const KERNEL_PATH = process.env.KERNEL_PATH?.trim() || ""
const INITRD_PATH = process.env.INITRD_PATH?.trim() || ""

export const FIRECRACKER_PATH =
  process.env.FIRECRACKER_PATH?.trim() || process.env.FC_BINARY?.trim() || "/usr/bin/firecracker"

function hash(id: string) {
  let out = 2166136261
  for (const c of id) {
    out ^= c.charCodeAt(0)
    out = Math.imul(out, 16777619)
  }
  return (out >>> 0).toString(16).padStart(8, "0")
}

function tap(id: string) {
  return `vfc${hash(id).slice(0, 8)}`
}

function mac(id: string) {
  const idh = hash(id)
  return `AA:FC:${idh.slice(0, 2)}:${idh.slice(2, 4)}:${idh.slice(4, 6)}:${idh.slice(6, 8)}`
}

function net(id: string) {
  const n = Number.parseInt(hash(id), 16)
  const a = (n >>> 16) & 0xff
  const b = (n >>> 8) & 0xff
  return {
    host: `10.${a}.${b}.1`,
    guest: `10.${a}.${b}.2`,
    cidr: "30",
    mask: "255.255.255.252",
  }
}

function runIp(args: string[]) {
  execFileSync("ip", args, { stdio: ["ignore", "pipe", "pipe"] })
}

function fcReq(sock: string, method: "PUT" | "POST", path: string, body: unknown) {
  const data = body === null ? "" : JSON.stringify(body)
  return new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath: sock,
        path,
        method,
        headers:
          body === null
            ? undefined
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
              },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          const code = res.statusCode ?? 0
          if (code >= 200 && code < 300) return resolve()
          reject(
            new Error(
              `Firecracker API failed ${method} ${path}: ${code} ${Buffer.concat(chunks).toString("utf8")}`,
            ),
          )
        })
      },
    )
    req.on("error", reject)
    if (data.length > 0) req.write(data)
    req.end()
  })
}

async function waitForSock(sock: string, proc: ChildProcess) {
  const end = Date.now() + FC_SOCKET_WAIT_MS
  const exit = { out: null as { code: number | null; signal: NodeJS.Signals | null } | null }
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exit.out = { code, signal }
  }
  proc.once("exit", onExit)
  try {
    while (Date.now() < end) {
      const dead = exit.out
      if (dead)
        throw new Error(`Firecracker exited before socket ready (code=${dead.code} signal=${dead.signal})`)
      try {
        const s = await stat(sock)
        if (s.isSocket()) return
      } catch {}
      await Bun.sleep(50)
    }
    throw new Error(`Firecracker socket did not appear: ${sock}`)
  } finally {
    proc.removeListener("exit", onExit)
  }
}

function kernelArgs(host: string, guest: string, mask: string) {
  return `console=ttyS0 reboot=k panic=1 root=/dev/vda rw net.ifnames=0 init=/usr/local/bin/start-vm.sh ip=${guest}::${host}:${mask}::eth0:off`
}

function sshPort(id: string) {
  const x = Number.parseInt(hash(id).slice(0, 6), 16)
  return 20000 + (x % 20000)
}

async function free(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.listen(port, SSH_HOST, () => server.close(() => resolve(true)))
  })
}

async function pickPort(id: string) {
  const min = 20000
  const span = 20000
  const base = sshPort(id)
  for (let i = 0; i < span; i++) {
    const port = min + (((base - min) + i) % span)
    if (await free(port)) return port
  }
  throw new Error(`No free ssh port found in range ${min}-${min + span - 1}`)
}

export type FirecrackerVm = {
  proc: ChildProcess
  relay: ChildProcess
  tap: string
  sshPort: number
  rootfsPath: string
}

export async function start(input: { id: string; dir: string; rootfsPath: string }): Promise<FirecrackerVm> {
  const sock = join(input.dir, "fc.sock")
  const dev = tap(input.id)
  const ip = net(input.id)
  const sshPort = await pickPort(input.id)

  try {
    runIp(["link", "del", dev])
  } catch {}
  runIp(["tuntap", "add", "dev", dev, "mode", "tap"])
  runIp(["addr", "add", `${ip.host}/${ip.cidr}`, "dev", dev])
  runIp(["link", "set", dev, "up"])

  const proc = spawn(FIRECRACKER_PATH, ["--api-sock", sock], { stdio: ["ignore", "pipe", "pipe"] })
  proc.stderr?.on("data", () => undefined)

  try {
    await waitForSock(sock, proc)
    await fcReq(sock, "PUT", "/machine-config", {
      vcpu_count: Math.max(1, VM_CPUS),
      mem_size_mib: Math.max(128, VM_MEMORY_MIB),
      smt: false,
    })
    await fcReq(sock, "PUT", "/boot-source", {
      kernel_image_path: KERNEL_PATH,
      initrd_path: INITRD_PATH,
      boot_args: kernelArgs(ip.host, ip.guest, ip.mask),
    })
    await fcReq(sock, "PUT", "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: input.rootfsPath,
      is_root_device: true,
      is_read_only: false,
    })
    await fcReq(sock, "PUT", "/network-interfaces/eth0", {
      iface_id: "eth0",
      guest_mac: mac(input.id),
      host_dev_name: dev,
    })
    await fcReq(sock, "PUT", "/actions", { action_type: "InstanceStart" })

    const relay = spawn(
      SOCAT_PATH,
      [`TCP-LISTEN:${sshPort},bind=${SSH_HOST},fork,reuseaddr`, `TCP:${ip.guest}:22`],
      { stdio: ["ignore", "pipe", "pipe"] },
    )

    return { proc, relay, tap: dev, sshPort, rootfsPath: input.rootfsPath }
  } catch (err) {
    proc.kill("SIGTERM")
    proc.kill("SIGKILL")
    try {
      runIp(["link", "del", dev])
    } catch {}
    throw err
  }
}

export async function stop(vm: FirecrackerVm) {
  vm.relay.kill("SIGTERM")
  vm.relay.kill("SIGKILL")
  vm.proc.kill("SIGTERM")
  vm.proc.kill("SIGKILL")
  try {
    runIp(["link", "del", vm.tap])
  } catch {}
}

export function firecrackerVersion() {
  try {
    return execFileSync(FIRECRACKER_PATH, ["--version"], { stdio: ["ignore", "pipe", "pipe"] })
      .toString("utf8")
      .trim()
  } catch {
    return undefined
  }
}
