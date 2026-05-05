import { Gemini, type GeminiModelInput } from "./gemini"

export const adapters = [Gemini.adapter]

export const model = (id: string, options: Omit<GeminiModelInput, "id"> = {}) =>
  Gemini.model({ ...options, id })

export const gemini = model

export * as Google from "./google"
