import api, { type Env } from "./api"
import share from "./share"

// One Worker answers every legacy hostname: api.opencode.ai gets the GitHub App token exchange used by the V1 GitHub
// Action, and opncd.ai gets the session-sharing tombstone.
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).hostname.startsWith("api.")) return api.fetch(request, env, ctx)
    return share.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
