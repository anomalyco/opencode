import type { AnyApi } from "../../src/api.js"
import { Provider } from "../../src/provider.js"
import { Auth } from "../../src/route/auth.js"

/** A model on a bare API, served by a one-API provider: the shape the old protocol routes built. */
export const apiModel = <const A extends AnyApi>(
  api: A,
  id: string,
  input: {
    readonly baseURL: string
    readonly provider?: string
    readonly auth?: Auth.Definition
  } & Provider.ModelOptions<readonly [A], A["name"]>,
) =>
  Provider.make({
    id: input.provider ?? "openai",
    baseURL: input.baseURL,
    auth: Provider.custom(input.auth ?? Auth.none),
    apis: [api],
  }).model(id, { capabilities: input.capabilities, options: input.options })
