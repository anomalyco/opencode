import { typesafeAI, type Settings } from "../typesafe-ai.js"

export type { Settings } from "../typesafe-ai.js"

export const model = (modelID: string, { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {}) =>
  typesafeAI
    .configure({ apiKey, baseURL, headers, http: body === undefined ? undefined : { body } })
    .decision(modelID, providerOptions)
