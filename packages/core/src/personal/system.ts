import { Context, Effect, Layer } from "effect"
import os from "os"
import { exec } from "child_process"

export interface SystemInfo {
  platform: string
  arch: string
  hostname: string
  uptime: number
  totalMemory: number
  freeMemory: number
  cpuModel: string
  cpuCores: number
  cpuUsage: number
  diskFree: number
  diskTotal: number
}

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  memory: number
}

export interface BatteryInfo {
  charging: boolean
  level: number
  timeRemaining: number | null
}

export interface Interface {
  readonly getInfo: () => Effect.Effect<SystemInfo>
  readonly getProcesses: () => Effect.Effect<ProcessInfo[]>
  readonly getBattery: () => Effect.Effect<BatteryInfo | null>
  readonly notify: (title: string, message: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/System") {}

function execPromise(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000 }, (_err, stdout) => {
      resolve(stdout.trim())
    })
  })
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  return Service.of({
    getInfo: Effect.gen(function* () {
      const diskOut = yield* Effect.promise(() => execPromise("df -k / | tail -1"))
      const diskParts = diskOut.split(/\s+/)
      const diskTotal = parseInt(diskParts[1]) * 1024 || 0
      const diskFree = parseInt(diskParts[3]) * 1024 || 0
      const cpus = os.cpus()
      const totalIdle = cpus.reduce((s, c) => s + c.times.idle, 0)
      const totalTick = cpus.reduce(
        (s, c) => s + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
        0,
      )
      return {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpuModel: cpus[0]?.model ?? "",
        cpuCores: cpus.length,
        cpuUsage: totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0,
        diskFree,
        diskTotal,
      }
    }),
    getProcesses: Effect.gen(function* () {
      const out = yield* Effect.promise(() => execPromise("ps aux --sort=-%cpu | head -20"))
      const lines = out.split("\n").slice(1)
      return lines
        .filter((l) => l.trim())
        .map((line) => {
          const parts = line.split(/\s+/)
          return {
            pid: parseInt(parts[1]) || 0,
            name: parts[10] ?? "",
            cpu: parseFloat(parts[2]) || 0,
            memory: parseFloat(parts[3]) || 0,
          }
        })
    }),
    getBattery: Effect.gen(function* () {
      try {
        const acpiOut = yield* Effect.promise(() => execPromise("acpi -b"))
        if (!acpiOut) return null
        const levelMatch = acpiOut.match(/(\d+)%/)
        const level = levelMatch ? parseInt(levelMatch[1]) : 0
        const charging = acpiOut.includes("Charging")
        const remainingMatch = acpiOut.match(/(\d+):(\d+)/)
        const timeRemaining = remainingMatch
          ? parseInt(remainingMatch[1]) * 60 + parseInt(remainingMatch[2])
          : null
        return { charging, level, timeRemaining }
      } catch {
        return null
      }
    }),
    notify: (title, message) =>
      Effect.gen(function* () {
        const plat = os.platform()
        const escapedTitle = title.replace(/"/g, '\\"')
        const escapedMsg = message.replace(/"/g, '\\"')
        if (plat === "linux") {
          yield* Effect.promise(() =>
            execPromise(`notify-send "${escapedTitle}" "${escapedMsg}"`),
          )
        } else if (plat === "darwin") {
          yield* Effect.promise(() =>
            execPromise(
              `osascript -e 'display notification "${escapedMsg}" with title "${escapedTitle}"'`,
            ),
          )
        }
      }),
  })
}))

export const defaultLayer = layer

export { Service as System }
