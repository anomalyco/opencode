import type { Config, Settings } from "./openai.js"

export const config = ({
  apiKey,
  baseURL,
  body,
  headers: given,
  organization,
  project,
  queryParams,
  ...providerOptions
}: Settings = {}): Config => {
  const headers = {
    ...(organization === undefined ? {} : { "OpenAI-Organization": organization }),
    ...(project === undefined ? {} : { "OpenAI-Project": project }),
    ...given,
  }
  return {
    apiKey,
    baseURL,
    headers: Object.keys(headers).length === 0 ? undefined : headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
    queryParams,
  }
}
