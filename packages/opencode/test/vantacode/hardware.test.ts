import { describe, expect, test } from "bun:test"
import { computeTunedSettings, normalizeGfx, verifyOffload, type HardwareInfo } from "@/vantacode/hardware"

function hw(partial: Partial<HardwareInfo>): HardwareInfo {
  return {
    platform: "linux",
    cpuThreads: 16,
    totalRamMB: 32000,
    gpus: [],
    ...partial,
  }
}

describe("normalizeGfx", () => {
  test("converts gfx1030 to 10.3.0", () => {
    expect(normalizeGfx("gfx1030")).toBe("10.3.0")
  })
  test("returns undefined for junk", () => {
    expect(normalizeGfx("nonsense")).toBeUndefined()
  })
})

describe("computeTunedSettings", () => {
  test("nvidia high-VRAM enables flash attention and full offload", () => {
    const gpu = { vendor: "nvidia" as const, name: "RTX 4090", vramTotalMB: 24000 }
    const tuned = computeTunedSettings({ hardware: hw({ gpus: [gpu], primaryGpu: gpu }) })
    expect(tuned.options.num_gpu).toBe(999)
    expect(tuned.env.OLLAMA_FLASH_ATTENTION).toBe("1")
    expect(tuned.options.num_thread).toBe(14)
    expect(tuned.env.OLLAMA_NUM_PARALLEL).toBe("4")
  })

  test("cpu-only machine offloads nothing", () => {
    const tuned = computeTunedSettings({ hardware: hw({ gpus: [], primaryGpu: undefined }) })
    expect(tuned.options.num_gpu).toBe(0)
    expect(tuned.env.OLLAMA_FLASH_ATTENTION).toBeUndefined()
  })

  test("amd sets HSA override and compute type", () => {
    const gpu = { vendor: "amd" as const, name: "RX 6800", vramTotalMB: 16000, gfx: "gfx1030" }
    const tuned = computeTunedSettings({ hardware: hw({ gpus: [gpu], primaryGpu: gpu }) })
    expect(tuned.env.HSA_OVERRIDE_GFX_VERSION).toBe("10.3.0")
    expect(tuned.env.OLLAMA_COMPUTE_TYPE).toBe("f16")
  })

  test("desired context is clamped to VRAM capacity", () => {
    const gpu = { vendor: "nvidia" as const, name: "RTX 3060", vramTotalMB: 8000 }
    const tuned = computeTunedSettings({ hardware: hw({ gpus: [gpu], primaryGpu: gpu }), desiredContext: 99999 })
    expect(tuned.options.num_ctx).toBeLessThanOrEqual(8192)
  })
})

describe("verifyOffload", () => {
  test("reports gpu when nearly all resident in VRAM", () => {
    expect(verifyOffload(999, { size: 1000, size_vram: 950 }).status).toBe("gpu")
  })
  test("reports cpu when nothing in VRAM despite request", () => {
    expect(verifyOffload(999, { size: 1000, size_vram: 0 }).status).toBe("cpu")
  })
  test("reports partial for split placement", () => {
    expect(verifyOffload(999, { size: 1000, size_vram: 500 }).status).toBe("partial")
  })
  test("unknown when model not loaded", () => {
    expect(verifyOffload(999, undefined).status).toBe("unknown")
  })
})
