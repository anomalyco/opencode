import * as Gemini from "../protocols/gemini"
import type { GeminiModelInput } from "../protocols/gemini"

export const adapters = [Gemini.adapter]

export const model = (id: string, options: Omit<GeminiModelInput, "id"> = {}) =>
  Gemini.model({ ...options, id })
