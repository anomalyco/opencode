import type { AdapterModelInput } from "../adapter/client"
import * as Gemini from "../protocols/gemini"

export const adapters = [Gemini.adapter]

export const model = (id: string, options: Omit<AdapterModelInput, "id"> = {}) =>
  Gemini.model({ ...options, id })
