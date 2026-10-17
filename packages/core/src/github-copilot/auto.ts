export * as CopilotAuto from "./auto.js"

import { Schema } from "effect"

const Response = Schema.Struct({
  session_token: Schema.String,
  expires_at: Schema.Number,
  selected_model: Schema.Struct({ id: Schema.String }),
})
const decodeResponse = Schema.decodeUnknownSync(Response)

/** A Session's routed model. `token` unlocks auto-only models and the auto discount. */
export interface Route {
  readonly model: string
  readonly token?: string
  /** Epoch milliseconds after which the Session must be routed again. */
  readonly until: number
}

// Copilot session tokens last 24 hours; route again before one can expire mid-request.
const refreshMargin = 5 * 60 * 1000

/** Asks Copilot's auto router which model should serve a prompt. */
export async function route(
  baseURL: string,
  headers: Record<string, string>,
  input: { readonly prompt: string; readonly image: boolean },
): Promise<Route> {
  const response = await fetch(`${baseURL}/auto`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: input.prompt, ...(input.image ? { has_image: true } : {}) }),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`Copilot auto routing failed: ${response.status}`)
  const body = decodeResponse(await response.json())
  return {
    model: body.selected_model.id,
    token: body.session_token,
    until: body.expires_at * 1000 - refreshMargin,
  }
}
