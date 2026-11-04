import { Database } from "@opencode/core/database/database"
import { ModelsDev } from "@opencode/core/models-dev"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Schema } from "effect"
import type { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"

export const ServerOptions = Schema.Struct({
  app: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      version: Schema.optional(Schema.String),
      channel: Schema.optional(Schema.String),
    }),
  ),
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535))),
  password: Schema.optional(Schema.String),
  cors: Schema.optional(Schema.Array(Schema.String)),
  simulation: Schema.optional(Schema.Boolean),
  database: Schema.optional(Database.Options),
  pty: Schema.optional(PersistentPty.Options),
  events: Schema.optional(
    Schema.Struct({
      persist: Schema.optional(Schema.Boolean),
    }),
  ),
  models: Schema.optional(ModelsDev.Options),
  /**
   * Replaces `globalThis.fetch` for OpenCode's own HTTP requests: OpenCode Console config, model requests, web fetch
   * and search, well-known config, and remote MCP servers. Agent code in Code Mode keeps `globalThis.fetch`. For
   * example, a Cloudflare Worker can route requests through a Service Binding.
   */
  fetch: Schema.optional(Schema.declare((input): input is LayerNodePlatform.Fetch => typeof input === "function")),
  /**
   * How a connected OpenCode Console's config is used. `poll` (default `true`) re-checks it every minute in the
   * background. With `poll: false` it refreshes only when a prompt starts, so a host that suspends between prompts,
   * such as a Durable Object, can stay idle. `required` (default `false`) holds every model request, including resumed
   * ones, until the active credential's config is loaded and applied, and fails the execution with a
   * `console.config-unavailable` error when that doesn't happen within about 10 seconds.
   */
  console: Schema.optional(
    Schema.Struct({ poll: Schema.optional(Schema.Boolean), required: Schema.optional(Schema.Boolean) }),
  ),
  config: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      project: Schema.optional(Schema.Boolean),
      claude: Schema.optional(Schema.Boolean),
      file: Schema.optional(Schema.String),
      content: Schema.optional(Schema.String),
    }),
  ),
  windows: Schema.optional(
    Schema.Struct({
      gitbash: Schema.optional(Schema.String),
    }),
  ),
  fs: Schema.optional(
    Schema.Struct({
      filewatcher: Schema.optional(Schema.Boolean),
      fff: Schema.optional(Schema.Boolean),
    }),
  ),
})
export type ServerOptions = typeof ServerOptions.Type
