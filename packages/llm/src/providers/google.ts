import type { AdapterModelInput } from "../adapter/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as Gemini from "../protocols/gemini"

export const adapters = [Gemini.adapter]

export const model = (id: string | ModelID, options: Omit<AdapterModelInput, "id"> = {}) =>
  Gemini.model({ ...options, id })

export const provider = Provider.make({
  id: ProviderID.make("google"),
  model,
})
