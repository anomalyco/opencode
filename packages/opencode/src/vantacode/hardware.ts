/**
 * Hardware detection and Ollama performance auto-tuning for VantaCode.
 *
 * Detects GPU vendor / VRAM (nvidia-smi, rocm-smi, Apple unified memory) and
 * computes recommended Ollama runtime options + environment variables so local
 * models run as fast as the machine allows. Everything is best-effort: if a
 * probe fails we degrade gracefully to conservative CPU defaults.
 *
 * Dependency-free (node:child_process + node:os) so it can be unit tested and
 * reused by the doctor / optimize commands without the Effect runtime.
 */

import { execFile } from "node:child_process"
import os from "node:os"

export type GpuVendor = "nvidia" | "amd" | "apple" | "unknown"

export interface GpuInfo {
  readonly vendor: GpuVendor
  readonly name: string
  /** Total VRAM in MB (unified memory for Apple). */
  readonly vramTotalMB: number
  /** Free VRAM in MB if known. */
  readonly vramFreeMB?: number
  /** AMD gfx architecture string if detected, e.g. "gfx1030". */
  readonly gfx?: string
}

export interface HardwareInfo {
  readonly platform: NodeJS.Platform
  readonly cpuThreads: number
  readonly totalRamMB: number
  readonly gpus: GpuInfo[]
  /** The GPU we will target for offload (largest VRAM). */
  readonly primaryGpu?: GpuInfo
}

export interface TunedSettings {
  /** Ollama request options (passed as `options` in /api/chat). */
  readonly options: {
    readonly num_gpu: number
    readonly num_thread: number
    readonly num_ctx: number
  }
  /** Environment variables the Ollama *server* should be started with. */
  readonly env: Record<string, string>
  /** Human-readable notes explaining each decision. */
  readonly notes: string[]
}

export interface ComputeTuneInput {
  readonly hardware: HardwareInfo
  /** Size of the model on disk in MB (from /api/show or /api/tags). */
  readonly modelSizeMB?: number
  /** Desired context window; clamped to what VRAM can support. */
  readonly desiredContext?: number
}

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        if (err) {
          resolve("")
          return
        }
        resolve(stdout ?? "")
      })
    } catch {
      resolve("")
    }
  })
}

/** Normalize an AMD gfx string to the HSA_OVERRIDE_GFX_VERSION value. */
export function normalizeGfx(gfx: string): string | undefined {
  // AMD gfx ids encode the ISA as <major><minor><stepping>, where the last hex
  // digit is the stepping, the second-to-last is the minor, and everything
  // before that is the major generation. e.g. gfx1030 -> 10.3.0, gfx900 -> 9.0.0.
  const match = gfx.match(/gfx([0-9a-f]+)/i)
  if (!match) return undefined
  const digits = match[1]
  if (digits.length < 3) return undefined
  const major = Number.parseInt(digits.slice(0, digits.length - 2), 10)
  const minor = Number.parseInt(digits[digits.length - 2], 16)
  const stepping = Number.parseInt(digits[digits.length - 1], 16)
  if ([major, minor, stepping].some((n) => Number.isNaN(n))) return undefined
  return `${major}.${minor}.${stepping}`
}

async function detectNvidia(): Promise<GpuInfo[]> {
  const out = await run("nvidia-smi", [
    "--query-gpu=name,memory.total,memory.free",
    "--format=csv,noheader,nounits",
  ])
  if (!out.trim()) return []
  const gpus: GpuInfo[] = []
  for (const line of out.trim().split("\n")) {
    const parts = line.split(",").map((p) => p.trim())
    if (parts.length < 2) continue
    const name = parts[0]
    const total = Number.parseInt(parts[1], 10)
    const free = parts[2] !== undefined ? Number.parseInt(parts[2], 10) : undefined
    if (Number.isNaN(total)) continue
    gpus.push({
      vendor: "nvidia",
      name,
      vramTotalMB: total,
      vramFreeMB: free !== undefined && !Number.isNaN(free) ? free : undefined,
    })
  }
  return gpus
}

async function detectAmd(): Promise<GpuInfo[]> {
  // Try JSON output first (newer rocm-smi).
  const json = await run("rocm-smi", ["--showmeminfo", "vram", "--showproductname", "--json"])
  if (json.trim()) {
    try {
      const parsed = JSON.parse(json) as Record<string, Record<string, string>>
      const gpus: GpuInfo[] = []
      for (const [card, info] of Object.entries(parsed)) {
        if (!card.toLowerCase().startsWith("card")) continue
        const totalBytes = Number.parseInt(
          info["VRAM Total Memory (B)"] ?? info["VRAM Total Memory (bytes)"] ?? "0",
          10,
        )
        const name = info["Card series"] ?? info["Card model"] ?? info["Card SKU"] ?? "AMD GPU"
        const gfxRaw = info["GFX Version"] ?? info["gfx_version"]
        const gpu: GpuInfo = {
          vendor: "amd",
          name,
          vramTotalMB: Number.isNaN(totalBytes) ? 0 : Math.round(totalBytes / (1024 * 1024)),
          gfx: gfxRaw ? gfxRaw.replace(/[^a-z0-9]/gi, "").toLowerCase() : undefined,
        }
        gpus.push(gpu)
      }
      if (gpus.length > 0) return gpus
    } catch {
      // fall through
    }
  }
  return []
}

async function detectApple(): Promise<GpuInfo[]> {
  if (os.platform() !== "darwin") return []
  // On Apple Silicon the GPU shares system memory; report unified memory as VRAM.
  const totalMB = Math.round(os.totalmem() / (1024 * 1024))
  const cpuModel = os.cpus()[0]?.model ?? "Apple Silicon"
  const isAppleSilicon = os.arch() === "arm64"
  if (!isAppleSilicon) return []
  return [
    {
      vendor: "apple",
      name: `${cpuModel} (unified memory)`,
      // Ollama can generally use ~70% of unified memory for the GPU.
      vramTotalMB: Math.round(totalMB * 0.7),
    },
  ]
}

export async function detectHardware(): Promise<HardwareInfo> {
  const platform = os.platform()
  const cpuThreads = os.cpus().length || 1
  const totalRamMB = Math.round(os.totalmem() / (1024 * 1024))

  const [nvidia, amd, apple] = await Promise.all([detectNvidia(), detectAmd(), detectApple()])
  const gpus = [...nvidia, ...amd, ...apple]

  const primaryGpu = gpus.length > 0 ? gpus.reduce((a, b) => (b.vramTotalMB > a.vramTotalMB ? b : a)) : undefined

  return { platform, cpuThreads, totalRamMB, gpus, primaryGpu }
}

/** Pick a context window that fits comfortably in available VRAM. */
function contextForVram(vramMB: number, desired?: number): number {
  let cap: number
  if (vramMB >= 24000) cap = 32768
  else if (vramMB >= 16000) cap = 16384
  else if (vramMB >= 12000) cap = 12288
  else if (vramMB >= 8000) cap = 8192
  else if (vramMB >= 6000) cap = 4096
  else cap = 2048
  if (desired && desired > 0) return Math.min(desired, cap)
  return cap
}

export function computeTunedSettings(input: ComputeTuneInput): TunedSettings {
  const { hardware, modelSizeMB, desiredContext } = input
  const notes: string[] = []
  const env: Record<string, string> = {}

  const gpu = hardware.primaryGpu
  const vram = gpu?.vramTotalMB ?? 0

  // num_thread: leave 2 threads for the system when we have plenty.
  const num_thread = hardware.cpuThreads >= 8 ? hardware.cpuThreads - 2 : Math.max(1, hardware.cpuThreads - 1)
  notes.push(`num_thread=${num_thread} (of ${hardware.cpuThreads} CPU threads)`)

  // num_gpu: 999 asks Ollama to offload as many layers as fit. If the model is
  // known to be larger than VRAM we still send 999 and let verifyOffload warn.
  let num_gpu = 0
  if (gpu && vram > 0) {
    num_gpu = 999
    if (modelSizeMB && modelSizeMB > vram) {
      notes.push(
        `model (~${modelSizeMB}MB) is larger than VRAM (${vram}MB); Ollama will split layers to CPU`,
      )
    } else {
      notes.push(`num_gpu=999 → offload all layers to ${gpu.name} (${vram}MB VRAM)`)
    }
  } else {
    notes.push("no GPU detected → CPU-only inference (num_gpu=0)")
  }

  const num_ctx = contextForVram(vram, desiredContext)
  notes.push(`num_ctx=${num_ctx}`)

  // Flash attention: safe + faster on nvidia and apple metal.
  if (gpu && (gpu.vendor === "nvidia" || gpu.vendor === "apple")) {
    env.OLLAMA_FLASH_ATTENTION = "1"
    notes.push("OLLAMA_FLASH_ATTENTION=1")
  }

  // Parallelism / loaded models scale with VRAM.
  if (vram >= 24000) {
    env.OLLAMA_NUM_PARALLEL = "4"
    env.OLLAMA_MAX_LOADED_MODELS = "3"
  } else if (vram >= 12000) {
    env.OLLAMA_NUM_PARALLEL = "2"
    env.OLLAMA_MAX_LOADED_MODELS = "2"
  } else if (vram > 0) {
    env.OLLAMA_NUM_PARALLEL = "1"
    env.OLLAMA_MAX_LOADED_MODELS = "1"
  }
  if (env.OLLAMA_NUM_PARALLEL) {
    notes.push(
      `OLLAMA_NUM_PARALLEL=${env.OLLAMA_NUM_PARALLEL}, OLLAMA_MAX_LOADED_MODELS=${env.OLLAMA_MAX_LOADED_MODELS}`,
    )
  }

  // AMD-specific overrides.
  if (gpu && gpu.vendor === "amd") {
    if (gpu.gfx) {
      const override = normalizeGfx(gpu.gfx)
      if (override) {
        env.HSA_OVERRIDE_GFX_VERSION = override
        notes.push(`HSA_OVERRIDE_GFX_VERSION=${override} (from ${gpu.gfx})`)
      }
    }
    env.OLLAMA_COMPUTE_TYPE = "f16"
    notes.push("OLLAMA_COMPUTE_TYPE=f16 (AMD ROCm)")
  }

  return {
    options: { num_gpu, num_thread, num_ctx },
    env,
    notes,
  }
}

export type OffloadStatus = "gpu" | "partial" | "cpu" | "unknown"

export interface OffloadVerification {
  readonly status: OffloadStatus
  readonly ratio: number
  readonly message: string
}

/**
 * Verify how much of the model actually landed on the GPU using /api/ps output.
 * `sizeVram` and `size` come from an Ollama /api/ps model entry.
 */
export function verifyOffload(requestedGpu: number, loaded: { size?: number; size_vram?: number } | undefined): OffloadVerification {
  if (!loaded || !loaded.size || loaded.size <= 0) {
    return { status: "unknown", ratio: 0, message: "model not currently loaded; cannot verify offload" }
  }
  const vramBytes = loaded.size_vram ?? 0
  const ratio = vramBytes / loaded.size
  if (requestedGpu <= 0) {
    return { status: "cpu", ratio, message: "CPU-only was requested" }
  }
  if (ratio >= 0.9) {
    return { status: "gpu", ratio, message: `${Math.round(ratio * 100)}% of model resident on GPU` }
  }
  if (ratio <= 0.05) {
    return {
      status: "cpu",
      ratio,
      message: "GPU offload was requested but the model is running on CPU — check drivers / VRAM",
    }
  }
  return {
    status: "partial",
    ratio,
    message: `only ${Math.round(ratio * 100)}% of model on GPU — VRAM may be too small for full offload`,
  }
}
