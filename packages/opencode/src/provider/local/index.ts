import { Log } from "../../util/log"
import { ollama_probe_loaded_models } from "./ollama"
import { lmstudio_probe_loaded_models } from "./lmstudio"
import { llamaccpp_probe_loaded_models } from "./llamacpp"

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

  export async function probe(provider: LocalProvider, url: string): Promise<LocalModel[]> {
    switch (provider) {
      case LocalProvider.Ollama:
        return await ollama_probe_loaded_models(url)
      case LocalProvider.LMStudio:
        return await lmstudio_probe_loaded_models(url)
      case LocalProvider.LlamaCPP:
        return await llamaccpp_probe_loaded_models(url)
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }
}
