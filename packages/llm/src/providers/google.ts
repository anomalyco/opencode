import type { RouteModelInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as Gemini from "../protocols/gemini"

export const id = ProviderID.make("google")

export const routes = [Gemini.route]

export const model = (id: string | ModelID, options: Omit<RouteModelInput, "id" | "baseURL"> & { readonly baseURL?: string } = {}) =>
  Gemini.model({ ...options, id })

export const provider = Provider.make({
  id,
  model,
})
