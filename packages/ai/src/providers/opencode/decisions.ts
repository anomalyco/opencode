import { opencode, type Settings } from "../opencode.js"

export type { Settings } from "../opencode.js"

export const model = (modelID: string, { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {}) =>
  opencode
    .configure({ apiKey, baseURL, headers, http: body === undefined ? undefined : { body } })
    .decision(modelID, providerOptions)
