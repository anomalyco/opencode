import { spawn, type ChildProcess } from "child_process"
import { existsSync } from "node:fs"
import { writeFile } from "fs/promises"
import { createServer } from "net"
import { join } from "path"

const VM_MEMORY_MIB = Number(process.env.VM_MEMORY_MIB ?? "1024")
const VM_CPUS = Number(process.env.VM_CPUS ?? "1")
const SSH_HOST = process.env.SSH_HOST ?? "127.0.0.1"
const MOUNT_TAG = "veritly9p"

export type GuestKind = "aarch64" | "x86_64"

export function guestKind(): GuestKind {
  return process.arch === "arm64" ? "aarch64" : "x86_64"
}

export function qemuBinary(kind: GuestKind) {
  const o = process.env.QEMU_PATH?.trim()
  if (o) return o
  const base = kind === "aarch64" ? "qemu-system-aarch64" : "qemu-system-x86_64"
  const w = Bun.which(base)
  if (w) return w
  if (process.platform === "darwin") {
    const brew = join("/opt/homebrew/bin", base)
    if (existsSync(brew)) return brew
    const loc = join("/usr/local/bin", base)
    if (existsSync(loc)) return loc
  }
  return base
}

export function qemuVersion(kind: GuestKind) {
  const r = Bun.spawnSync([qemuBinary(kind), "--version"], { stdout: "pipe", stderr: "ignore" })
  if (!r.success) return undefined
  return new TextDecoder().decode(r.stdout).trim().split("\n")[0]
}

function hash(id: string) {
  let out = 2166136261
  for (const c of id) {
    out ^= c.charCodeAt(0)
    out = Math.imul(out, 16777619)
  }
  return (out >>> 0).toString(16).padStart(8, "0")
}

function sshPort(id: string) {
  const x = Number.parseInt(hash(id).slice(0, 6), 16)
  return 20000 + (x % 20000)
}

async function free(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = createServer()
    s.once("error", () => resolve(false))
    s.listen(port, SSH_HOST, () => s.close(() => resolve(true)))
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

function hw(kind: GuestKind): string[] {
  if (process.platform === "darwin") {
    if (kind === "aarch64") return ["-accel", "hvf", "-cpu", "host"]
    return ["-accel", "tcg", "-cpu", "qemu64"]
  }
  const host: GuestKind = process.arch === "arm64" ? "aarch64" : "x86_64"
  const kvm = existsSync("/dev/kvm") && kind === host
  if (kvm) return ["-accel", "kvm", "-cpu", "host"]
  if (kind === "aarch64") return ["-accel", "tcg", "-cpu", "max"]
  return ["-accel", "tcg", "-cpu", "qemu64"]
}

function machine(kind: GuestKind) {
  if (kind === "aarch64") return ["-M", "virt"]
  return ["-M", "q35"]
}

function cmdline(kind: GuestKind) {
  const dev = kind === "aarch64" ? "ttyAMA0" : "ttyS0"
  const early = kind === "aarch64" ? " earlycon=pl011,0x9000000" : ""
  return `console=${dev}${early} net.ifnames=0 rw init=/sbin/veritly-init root=${MOUNT_TAG} rootfstype=9p rootflags=trans=virtio,cache=loose,msize=524288`
}

export type QemuVm = {
  proc: ChildProcess
  sshPort: number
  dir: string
  kind: GuestKind
}

export async function start(opts: {
  id: string
  dir: string
  rootfsDir: string
  kernel: string
  initrd?: string
  kind: GuestKind
}): Promise<QemuVm> {
  const sshPort = await pickPort(opts.id)
  const serial = join(opts.dir, "serial.log")
  const pidfile = join(opts.dir, "qemu.pid")
  const bin = qemuBinary(opts.kind)
  const args = [
    ...machine(opts.kind),
    ...hw(opts.kind),
    "-smp",
    String(Math.max(1, VM_CPUS)),
    "-m",
    String(Math.max(128, VM_MEMORY_MIB)),
    "-nodefaults",
    "-display",
    "none",
    "-serial",
    `file:${serial}`,
    "-kernel",
    opts.kernel,
    "-append",
    cmdline(opts.kind),
    "-netdev",
    `user,id=n0,hostfwd=tcp:${SSH_HOST}:${sshPort}-:22`,
    "-device",
    "virtio-net-pci,netdev=n0",
    "-virtfs",
    `local,path=${opts.rootfsDir},mount_tag=${MOUNT_TAG},security_model=none`,
    "-device",
    "virtio-rng-pci",
  ]
  if (opts.initrd && existsSync(opts.initrd)) {
    args.push("-initrd", opts.initrd)
  }

  const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
  proc.stderr?.on("data", () => undefined)
  if (!proc.pid) throw new Error("qemu failed to start (no pid)")
  await writeFile(pidfile, `${proc.pid}\n`)
  return { proc, sshPort, dir: opts.dir, kind: opts.kind }
}

export async function stop(vm: QemuVm) {
  vm.proc.kill("SIGTERM")
  vm.proc.kill("SIGKILL")
}
