import { Log } from "../../util/log"
import { ollama_probe_loaded_models, ollama_detect_provider } from "./ollama"
import { lmstudio_probe_loaded_models, lmstudio_detect_provider } from "./lmstudio"
import { llamacpp_probe_loaded_models, llamacpp_detect_provider } from "./llamacpp"

export enum LocalProvider {
  Ollama = "ollama",
  LMStudio = "lmstudio",
  LlamaCPP = "llamacpp",
}

export interface LocalModel {
  id: string
  context_length: number
  tool_call: boolean
  vision: boolean
}

export namespace LocalProvider {
  const log = Log.create({ service: "localprovider" })

  export async function detect_provider(url: string): Promise<LocalProvider | null> {
    log.debug(`Detecting local provider at URL: ${url}`)

    if (await ollama_detect_provider(url)) {
      log.info(`Detected Ollama provider at URL: ${url}`)
      return LocalProvider.Ollama
    }

    if (await lmstudio_detect_provider(url)) {
      log.info(`Detected LMStudio provider at URL: ${url}`)
      return LocalProvider.LMStudio
    }

    if (await llamacpp_detect_provider(url)) {
      log.info(`Detected LlamaCPP provider at URL: ${url}`)
      return LocalProvider.LlamaCPP
    }

    log.info(`No supported local provider detected at URL: ${url}`)
    return null
  }

  export async function probe_provider(provider: LocalProvider, url: string): Promise<LocalModel[]> {
    switch (provider) {
      case LocalProvider.Ollama:
        return await ollama_probe_loaded_models(url)
      case LocalProvider.LMStudio:
        return await lmstudio_probe_loaded_models(url)
      case LocalProvider.LlamaCPP:
        return await llamacpp_probe_loaded_models(url)
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
