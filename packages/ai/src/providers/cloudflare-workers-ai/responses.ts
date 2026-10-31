import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"
import type { CloudflareWorkersAI } from "../cloudflare-workers-ai.js"
export { responsesModel as model } from "../cloudflare-workers-ai.js"
export type Settings = CloudflareWorkersAI.Settings<OpenResponsesProviderOptionsInput>
