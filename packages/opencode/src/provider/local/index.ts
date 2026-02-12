import { Log } from "../../util/log"
import { ollama_probe_loaded_models, ollama_detect_provider } from "./ollama"
import { lmstudio_probe_loaded_models, lmstudio_detect_provider } from "./lmstudio"
import { llamacpp_probe_loaded_models, llamacpp_detect_provider } from "./llamacpp"
import { vllm_probe_loaded_models, vllm_detect_provider } from "./vllm"

export enum LocalProvider {
  Ollama = "ollama",
  LMStudio = "lmstudio",
  LlamaCPP = "llamacpp",
  Vllm = "vllm",
}

export interface LocalModel {
  id: string
  context_length: number
  tool_call: boolean
  vision: boolean
}

export namespace LocalProvider {
  const log = Log.create({ service: "provider.local" })

  function normalizeUrl(url: string): string {
    const base = url.endsWith("/v1") ? url.slice(0, -3) : url
    if (base.endsWith("/")) return base.slice(0, -1)
    return base
  }

  export async function detect_provider(url: string): Promise<LocalProvider | null> {
    const base = normalizeUrl(url)
    log.debug(`Detecting local provider at URL: ${base}`)

    if (await ollama_detect_provider(base)) {
      log.info(`Detected Ollama provider at URL: ${base}`)
      return LocalProvider.Ollama
    }

    if (await lmstudio_detect_provider(base)) {
      log.info(`Detected LMStudio provider at URL: ${base}`)
      return LocalProvider.LMStudio
    }

    if (await llamacpp_detect_provider(base)) {
      log.info(`Detected LlamaCPP provider at URL: ${base}`)
      return LocalProvider.LlamaCPP
    }

    if (await vllm_detect_provider(base)) {
      log.info(`Detected vLLM provider at URL: ${base}`)
      return LocalProvider.Vllm
    }

    log.info(`No supported local provider detected at URL: ${base}`)
    return null
  }

  export async function probe_provider(provider: LocalProvider, url: string): Promise<LocalModel[]> {
    const base = normalizeUrl(url)
    switch (provider) {
      case LocalProvider.Ollama:
        return await ollama_probe_loaded_models(base)
      case LocalProvider.LMStudio:
        return await lmstudio_probe_loaded_models(base)
      case LocalProvider.LlamaCPP:
        return await llamacpp_probe_loaded_models(base)
      case LocalProvider.Vllm:
        return await vllm_probe_loaded_models(base)
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }

  export async function probe_url(url: string): Promise<[LocalProvider, LocalModel[]]> {
    const provider = await detect_provider(url)
    if (!provider) {
      throw new Error(`No supported local provider detected at URL: ${url}`)
    }

    return [provider, await probe_provider(provider, url)]
  }
}
