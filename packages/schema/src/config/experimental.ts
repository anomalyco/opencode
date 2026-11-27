export * as ConfigExperimental from "./experimental.js"

import { Record, Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "../schema.js"
import { ConfigFlag } from "./flag.js"
import { ConfigModel } from "./model.js"
import { ConfigPolicy } from "./policy.js"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Deprecated: the built-in shell permission scanner is now always enabled.",
  }),
  codemode_vm: Schema.Boolean.pipe(optional).annotate({
    description: "Deprecated: ignored because Code Mode always runs on the VM.",
  }),
  all_flags: Schema.Boolean.pipe(optional).annotate({
    description:
      "Enable all flags except opt-in-only flags on any build channel, like OPENCODE_FLAGS=all. Per-flag config settings take precedence over all_flags; false leaves the build defaults in effect.",
  }),
  ...Record.map(ConfigFlag.registry, (description, key) =>
    Schema.Boolean.pipe(optional).annotate({
      description:
        ConfigFlag.optInOnly.has(key) || ConfigFlag.localOnly.has(key)
          ? description
          : `${description} Defaults to on in local and dev builds and off in releases.`,
    }),
  ),
  video_generate: Schema.Union([
    Schema.Boolean,
    Schema.Struct({
      model: ConfigModel.Selection.pipe(optional).annotate({
        description:
          "Default model for the generate_video tool when the agent doesn't choose one, as providerID/modelID. Falls back to automatic selection when it isn't available.",
      }),
    }),
  ])
    .pipe(optional)
    .annotate({
      description:
        "Settings for the generate_video tool, which is offered while a connected provider has a video model.",
    }),
  part_rows: Schema.Boolean.pipe(optional).annotate({
    description:
      "Write each assistant part as its own session_part row instead of rewriting the whole message on every event. Defaults to true; set false to fall back to whole-message writes.",
  }),
  image_generate: Schema.Union([
    Schema.Boolean,
    Schema.Struct({
      model: ConfigModel.Selection.pipe(optional).annotate({
        description:
          "Default model for the generate_image tool when the agent doesn't choose one, as providerID/modelID. Falls back to automatic selection when it isn't available.",
      }),
    }),
  ])
    .pipe(optional)
    .annotate({
      description:
        "Settings for the generate_image tool, which is offered while a connected provider has an image model.",
    }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  location_idle_timeout: Schema.Union([Schema.DurationFromString, Schema.Literal(false)])
    .pipe(optional)
    .annotate({
      description:
        'How long a location can go without session activity before its services are unloaded. Running sessions and background jobs keep a location loaded. Set to false to never unload (default: "60 minutes")',
    }),
  location_cache_limit: Schema.Union([PositiveInt, Schema.Literal(false)])
    .pipe(optional)
    .annotate({
      description:
        "Maximum number of loaded locations kept in the service cache. The least recently used locations are unloaded above this count. Set to false to keep every loaded location (default: 16)",
    }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Deprecated: use top-level policies. Ordered policies controlling access to configured resources",
  }),
}) {}
