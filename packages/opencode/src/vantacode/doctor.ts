/**
 * VantaCode doctor: end-to-end readiness check for local Ollama inference.
 *
 * Runs a series of checks and returns a structured report the CLI can print:
 *   1. Ollama server reachable
 *   2. Requested model installed
 *   3. Model advertises tool capability (/api/show)
 *   4. Model family is known-good for agentic tool use
 *   5. Live tool-call test — the model is asked a question that REQUIRES a tool
 *      call and we verify it actually emits one (not plain narrated text)
 *   6. Hardware detected + recommended tuning
 *   7. GPU offload verification (if a model is loaded)
 */

import {
  OllamaClient,
  isKnownGoodToolModel,
  type OllamaModelInfo,
  type OllamaTool,
} from "./ollama.ts"
import { computeTunedSettings, detectHardware, verifyOffload, type HardwareInfo, type TunedSettings } from "./hardware.ts"

export type CheckStatus = "pass" | "warn" | "fail" | "skip"

export interface CheckResult {
  readonly id: string
  readonly title: string
  readonly status: CheckStatus
  readonly detail: string
  /** Actionable fix suggestion for warn/fail. */
  readonly fix?: string
}

export interface DoctorReport {
  readonly host: string
  readonly model?: string
  readonly checks: CheckResult[]
  readonly hardware?: HardwareInfo
  readonly tuned?: TunedSettings
  readonly ok: boolean
}

/** A trivial, explicitly-named tool the live test forces the model to call. */
export const TOOL_TEST_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "get_weather_current_location",
    description: "Get the current weather for the user's current location. Call this whenever the user asks about the weather.",
    parameters: {
      type: "object",
      properties: {
        unit: {
          type: "string",
          enum: ["celsius", "fahrenheit"],
          description: "Temperature unit to report",
        },
      },
      required: ["unit"],
    },
  },
}

export interface DoctorOptions {
  readonly host?: string
  readonly model?: string
  readonly debug?: boolean
  /** Skip the live tool-call test (network + model load). */
  readonly skipLiveTest?: boolean
  readonly fetchImpl?: typeof fetch
}

/**
 * Ask the model a weather question with the test tool available. A healthy
 * tool-capable model returns a tool_call for get_weather_current_location.
 */
export async function liveToolTest(
  client: OllamaClient,
  model: string,
): Promise<{ status: CheckStatus; detail: string; fix?: string }> {
  try {
    const res = await client.chat({
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are a tool-using assistant. When a tool is relevant you MUST call it via a tool call and MUST NOT answer in prose.",
        },
        { role: "user", content: "What is the weather at my current location in celsius?" },
      ],
      tools: [TOOL_TEST_TOOL],
      options: { temperature: 0 },
    })
    const calls = res.message?.tool_calls ?? []
    if (calls.length === 0) {
      return {
        status: "fail",
        detail: `Model replied with prose instead of a tool call: "${(res.message?.content ?? "").slice(0, 80)}"`,
        fix: "This model does not reliably emit tool calls. Try qwen2.5-coder, llama3.1, or mistral-nemo.",
      }
    }
    const call = calls[0]
    if (call.function.name !== TOOL_TEST_TOOL.function.name) {
      return {
        status: "warn",
        detail: `Model called "${call.function.name}" instead of the expected tool.`,
        fix: "Model can call tools but chose the wrong one; usable but verify carefully.",
      }
    }
    return { status: "pass", detail: `Model emitted a valid tool call with args ${JSON.stringify(call.function.arguments)}` }
  } catch (error) {
    return {
      status: "fail",
      detail: `Live tool-call test errored: ${(error as Error).message}`,
      fix: "Ensure the model is pulled (`ollama pull <model>`) and the server has enough memory.",
    }
  }
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const client = new OllamaClient({ host: options.host, debug: options.debug, fetchImpl: options.fetchImpl })
  const checks: CheckResult[] = []
  const host = client.host
  const model = options.model

  // 1. Server reachable.
  const version = await client.version()
  if (!version) {
    checks.push({
      id: "server",
      title: "Ollama server",
      status: "fail",
      detail: `No Ollama server responded at ${host}`,
      fix: "Start Ollama (`ollama serve`) or set OLLAMA_HOST to the correct address.",
    })
    return { host, model, checks, ok: false }
  }
  checks.push({ id: "server", title: "Ollama server", status: "pass", detail: `Reachable at ${host} (v${version})` })

  // 2 + 3. Model installed & tool-capable.
  let models: OllamaModelInfo[] = []
  try {
    models = await client.listModels()
  } catch (error) {
    checks.push({
      id: "models",
      title: "Installed models",
      status: "warn",
      detail: `Could not list models: ${(error as Error).message}`,
    })
  }

  let resolvedModel = model
  if (!resolvedModel && models.length > 0) {
    const good = models.find((m) => m.capabilities.tools) ?? models[0]
    resolvedModel = good.name
  }

  if (resolvedModel) {
    const info = models.find((m) => m.name === resolvedModel || m.name.split(":")[0] === resolvedModel.split(":")[0])
    if (!info) {
      checks.push({
        id: "model",
        title: "Requested model",
        status: "fail",
        detail: `Model "${resolvedModel}" is not installed`,
        fix: `Run: ollama pull ${resolvedModel}`,
      })
    } else {
      checks.push({ id: "model", title: "Requested model", status: "pass", detail: `${info.name} installed` })
      if (info.capabilities.tools) {
        checks.push({ id: "tools", title: "Tool capability", status: "pass", detail: `${info.name} advertises tool support` })
      } else {
        checks.push({
          id: "tools",
          title: "Tool capability",
          status: "fail",
          detail: `${info.name} does not advertise tool support`,
          fix: "Pick a tool-capable model such as qwen2.5-coder, llama3.1, mistral-nemo, or hermes3.",
        })
      }
      // 4. Known-good family.
      if (isKnownGoodToolModel(info.name)) {
        checks.push({ id: "family", title: "Model family", status: "pass", detail: `${info.name} is a known-good tool model` })
      } else {
        checks.push({
          id: "family",
          title: "Model family",
          status: "warn",
          detail: `${info.name} is not in the known-good list; tool reliability may vary`,
          fix: "Recommended: Qwen2.5/3 Coder, Llama 3.1 8B+, Mistral 7B, Hermes 3, or GLM-4-Flash.",
        })
      }
    }
  } else {
    checks.push({
      id: "model",
      title: "Requested model",
      status: "warn",
      detail: "No model specified and none installed",
      fix: "Run: ollama pull qwen2.5-coder:7b",
    })
  }

  // 5. Live tool-call test.
  if (options.skipLiveTest) {
    checks.push({ id: "live", title: "Live tool-call test", status: "skip", detail: "Skipped by request" })
  } else if (resolvedModel && checks.find((c) => c.id === "tools")?.status === "pass") {
    const live = await liveToolTest(client, resolvedModel)
    checks.push({ id: "live", title: "Live tool-call test", ...live })
  } else {
    checks.push({ id: "live", title: "Live tool-call test", status: "skip", detail: "Skipped (model not tool-capable)" })
  }

  // 6. Hardware + tuning.
  const hardware = await detectHardware()
  const modelInfo = models.find((m) => m.name === resolvedModel)
  const tuned = computeTunedSettings({
    hardware,
    modelSizeMB: modelInfo?.sizeBytes ? Math.round(modelInfo.sizeBytes / (1024 * 1024)) : undefined,
  })
  if (hardware.primaryGpu) {
    checks.push({
      id: "hardware",
      title: "Hardware",
      status: "pass",
      detail: `${hardware.primaryGpu.vendor} ${hardware.primaryGpu.name} (${hardware.primaryGpu.vramTotalMB}MB VRAM), ${hardware.cpuThreads} CPU threads`,
    })
  } else {
    checks.push({
      id: "hardware",
      title: "Hardware",
      status: "warn",
      detail: `No GPU detected; CPU-only (${hardware.cpuThreads} threads, ${hardware.totalRamMB}MB RAM)`,
      fix: "Install GPU drivers (NVIDIA CUDA / AMD ROCm) for much faster local inference.",
    })
  }

  // 7. Offload verification (only if a model is currently loaded).
  const loaded = await client.ps()
  const loadedModel = loaded.find((l) => l.name === resolvedModel) ?? loaded[0]
  if (loadedModel) {
    const off = verifyOffload(tuned.options.num_gpu, { size: loadedModel.sizeBytes, size_vram: loadedModel.sizeVramBytes })
    checks.push({
      id: "offload",
      title: "GPU offload",
      status: off.status === "gpu" ? "pass" : off.status === "unknown" ? "skip" : "warn",
      detail: off.message,
      fix: off.status === "cpu" || off.status === "partial" ? "Increase VRAM headroom or lower num_ctx; verify drivers." : undefined,
    })
  } else {
    checks.push({ id: "offload", title: "GPU offload", status: "skip", detail: "No model currently loaded to verify" })
  }

  const ok = !checks.some((c) => c.status === "fail")
  return { host, model: resolvedModel, checks, hardware, tuned, ok }
}
