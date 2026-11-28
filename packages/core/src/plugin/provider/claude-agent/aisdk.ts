export * as ClaudeAISDK from "./aisdk.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Credential } from "../../../credential.js"
import { ClaudeAccounts } from "./claude/accounts.js"
import { ClaudeQueryOptions } from "./claude/query-options.js"
import type { ClaudeSessions } from "./claude/sessions.js"
import { ClaudeAgentLanguageModel } from "./language-model/claude-agent-language-model.js"
import { ClaudeProvider } from "./provider.js"

export const register = Effect.fn("ClaudeAISDK.register")(function* (ctx: Context, sessions: ClaudeSessions.Interface) {
  const context = yield* Effect.context<Credential.Service>()
  const run = Effect.runPromiseWith(context)
  const accounts = ClaudeAccounts.make({ sessions, storage: ctx.storage })
  yield* ctx.aisdk.hook(
    "sdk",
    (evt) =>
      Effect.sync(() => {
        if (evt.package !== ClaudeProvider.PACKAGE) return
        // opencode spreads the model's settings into options, next to the configured headers and body
        const connection = ClaudeQueryOptions.connectionEnv({
          settings: evt.options,
          headers: evt.options.headers,
          body: evt.options.body,
        })
        const configDirs = ClaudeQueryOptions.configDirs(evt.options.configDir)
        const dependencies: ClaudeAgentLanguageModel.Dependencies = {
          run: (request, signal) =>
            run(
              Effect.gen(function* () {
                // Without a configured folder, the active account's folder applies. It is looked up per request, so
                // the retry that follows an account switch already runs on the new account.
                const dir = configDirs.length === 0 ? yield* ClaudeProvider.accountConfigDir(ctx) : undefined
                if (!dir) return yield* accounts.run(request, configDirs)
                yield* accounts.run({ ...request, connection: { ...request.connection, CLAUDE_CONFIG_DIR: dir } }, [dir])
              }),
              { signal },
            ),
        }
        evt.sdk = {
          languageModel: (modelID: string) => new ClaudeAgentLanguageModel.Model(modelID, dependencies, connection),
        }
      }),
    { providerID: ClaudeProvider.ID },
  )
})
