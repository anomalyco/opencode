import { existsSync } from "node:fs"
import { cp, mkdir, readFile, rm } from "fs/promises"
import { join } from "path"
import { NodeSSH } from "node-ssh"
import { qemuBinary, qemuVersion, start, stop, type GuestKind, type QemuVm } from "./vm/qemu"

export type ReadyzStatic = {
  qemuPath: string
  qemuRunnable: boolean
  kernelPath: string
  kernelBytes: number | null
  initrdPath: string | null
  initrdBytes: number | null
  templatePath: string
  templateBusyboxBytes: number | null
  templateOk: boolean
  kvmDevice: boolean
  platform: string
  hostArch: string
}

export type ReadyzVm = {
  probeId: string
  vmDir: string
  sshHost: string
  sshPort: number
  msToSsh: number
  command: string
  exitCode: number
  commandOutput: string
  msExec: number
  serialTail: string | null
}

export type ReadyzBody = {
  ok: boolean
  service: "executor"
  mode: "qemu"
  guest: GuestKind
  cached: boolean
  cachedAgeMs?: number
  qemuVersion?: string
  activeSessions: number
  static: ReadyzStatic
  vm: ReadyzVm | null
  errors: string[]
}

async function guestTpl(dir: string) {
  const s = await Bun.file(join(dir, "bin", "busybox")).stat().catch(() => null)
  return Boolean(s && s.size >= 1000)
}

async function waitSsh(ssh: NodeSSH, host: string, port: number, cap: number) {
  const end = Date.now() + cap
  let last: unknown
  while (Date.now() < end) {
    try {
      await ssh.connect({ host, port, username: "root", password: "root", readyTimeout: 5000 })
      return
    } catch (next) {
      last = next
      await Bun.sleep(500)
    }
  }
  throw new Error(`SSH: ${last instanceof Error ? last.message : String(last)}`)
}

async function tail(path: string, n: number) {
  const raw = await readFile(path, "utf8").catch(() => "")
  if (!raw) return null
  return raw.split("\n").slice(-n).join("\n")
}

export async function runReadyzProbe(input: {
  kind: GuestKind
  pkgOut: string
  vmData: string
  sshHost: string
  sshBootMs: number
  activeSessions: number
}): Promise<ReadyzBody> {
  const err: string[] = []
  const k = input.kind
  const bnd = (x: GuestKind) => join(input.pkgOut, x)
  const kern = process.env.KERNEL_PATH?.trim() || join(bnd(k), "vmlinuz")
  const initP = process.env.INITRD_PATH?.trim() || join(bnd(k), "initrd.img")
  const tpl = join(bnd(k), "guest-root")
  const bin = qemuBinary(k)
  const qemuRun = Bun.spawnSync([bin, "--version"], { stdout: "ignore", stderr: "ignore" }).success
  if (!qemuRun) err.push("qemu_not_runnable")

  const kst = await Bun.file(kern).stat().catch(() => null)
  if (!kst || kst.size < 4096) err.push("kernel_missing_or_small")

  const tplOk = await guestTpl(tpl)
  if (!tplOk) err.push("guest_template_invalid")

  let initPath: string | null = null
  let initBytes: number | null = null
  if (existsSync(initP)) {
    initPath = initP
    const ist = await Bun.file(initP).stat().catch(() => null)
    initBytes = ist?.size ?? null
    if (!ist || ist.size < 1024) err.push("initrd_invalid")
  }

  const stat: ReadyzStatic = {
    qemuPath: bin,
    qemuRunnable: qemuRun,
    kernelPath: kern,
    kernelBytes: kst?.size ?? null,
    initrdPath: initPath,
    initrdBytes: initBytes,
    templatePath: tpl,
    templateBusyboxBytes: (await Bun.file(join(tpl, "bin", "busybox")).stat().catch(() => null))?.size ?? null,
    templateOk: tplOk,
    kvmDevice: existsSync("/dev/kvm"),
    platform: process.platform,
    hostArch: process.arch,
  }

  if (err.length) {
    return {
      ok: false,
      service: "executor",
      mode: "qemu",
      guest: k,
      cached: false,
      qemuVersion: qemuRun ? qemuVersion(k) : undefined,
      activeSessions: input.activeSessions,
      static: stat,
      vm: null,
      errors: err,
    }
  }

  const id = `readyz-${Date.now()}`
  const base = join(input.vmData, "readyz-probes", id)
  const vmDir = join(base, "vm")
  const root = join(vmDir, "root")
  await mkdir(root, { recursive: true })
  await cp(tpl, root, { recursive: true })

  let vm: QemuVm | null = null
  const ssh = new NodeSSH()
  let serial: string | null = null
  let msSsh = 0
  let msEx = 0
  let code = -1
  let out = ""
  const cmd = "echo __readyz_ok__"

  try {
    const initrd = existsSync(initP) ? initP : undefined
    vm = await start({ id, dir: vmDir, rootfsDir: root, kernel: kern, initrd, kind: k })
    const t0 = Date.now()
    await waitSsh(ssh, input.sshHost, vm.sshPort, input.sshBootMs)
    msSsh = Date.now() - t0
    const t1 = Date.now()
    const r = await ssh.execCommand(`cd /workspace && sh -lc '${cmd.replaceAll("'", `'\\''`)}'`)
    msEx = Date.now() - t1
    code = r.code ?? 0
    out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim()
    if (code !== 0) err.push("probe_command_nonzero")
    if (!out.includes("__readyz_ok__")) err.push("probe_output_mismatch")
  } catch (e) {
    err.push(e instanceof Error ? e.message : String(e))
    serial = await tail(join(vmDir, "serial.log"), 48)
  } finally {
    ssh.dispose()
    if (vm) await stop(vm)
    await rm(base, { recursive: true, force: true }).catch(() => undefined)
  }

  const vmDiag: ReadyzVm = {
    probeId: id,
    vmDir,
    sshHost: input.sshHost,
    sshPort: vm?.sshPort ?? 0,
    msToSsh: msSsh,
    command: cmd,
    exitCode: code,
    commandOutput: out,
    msExec: msEx,
    serialTail: serial,
  }

  return {
    ok: err.length === 0,
    service: "executor",
    mode: "qemu",
    guest: k,
    cached: false,
    qemuVersion: qemuVersion(k),
    activeSessions: input.activeSessions,
    static: stat,
    vm: vmDiag,
    errors: err,
  }
}
